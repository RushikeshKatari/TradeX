"""Best-effort extraction of publicly rendered Groww option chart data.

Rendered SVG coordinates are estimates unless a numerical series is exposed by
the page. This module deliberately does not bypass authentication or bot checks.
"""
from __future__ import annotations
import site, sys
sys.path.append(site.getusersitepackages())
import csv
import io
import json
import math
import re
import struct
import zlib
from datetime import datetime, timezone
from html import unescape
from urllib.parse import urlparse
from typing import Optional
from xml.etree import ElementTree as ET


def parse_instrument(url: str) -> dict:
    tail = urlparse(url).path.rstrip("/").split("/")[-1].upper()
    match = re.fullmatch(r"([A-Z]+)(\d{2})([A-Z])(\d{2})(\d+)(CE|PE)", tail)
    if not match:
        return {"symbol": tail, "index": None, "expiry_code": None, "strike": None, "option_type": None}
    symbol, yy, month, day, strike, side = match.groups()
    return {"symbol": tail, "index": symbol, "expiry_code": f"{yy}{month}{day}",
            "strike": int(strike), "option_type": side}


def _tag(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def _matrix(transform: str) -> tuple[float, float, float, float, float, float]:
    a, b, c, d, e, f = 1., 0., 0., 1., 0., 0.
    for name, args in re.findall(r"(matrix|translate|scale)\(([^)]*)\)", transform or ""):
        v = [float(x) for x in re.split(r"[ ,]+", args.strip()) if x]
        if name == "matrix" and len(v) == 6: a,b,c,d,e,f = v
        elif name == "translate": e += v[0]; f += v[1] if len(v)>1 else 0
        elif name == "scale": a *= v[0]; d *= v[1] if len(v)>1 else v[0]
    return a,b,c,d,e,f


def _path_points(d: str) -> list[tuple[float, float]]:
    """Read common line commands from SVG paths; curve paths are sampled at endpoints."""
    tokens = re.findall(r"[A-Za-z]|[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:[eE][-+]?\d+)?", d)
    out=[]; i=0; cmd=None; x=y=0.; start=(0.,0.)
    arity={"M":2,"L":2,"H":1,"V":1,"C":6,"S":4,"Q":4,"T":2,"A":7}
    while i<len(tokens):
        if tokens[i].isalpha(): cmd=tokens[i]; i+=1
        if not cmd: break
        up=cmd.upper(); n=arity.get(up)
        if not n or i+n>len(tokens) or tokens[i].isalpha():
            if up=="Z": x,y=start; out.append((x,y)); cmd=None; continue
            break
        vals=list(map(float,tokens[i:i+n])); i+=n; rel=cmd.islower(); ox,oy=(x,y) if rel else (0.,0.)
        if up in "ML": x,y=vals[0]+ox, vals[1]+oy
        elif up=="H": x=vals[0]+ox
        elif up=="V": y=vals[0]+oy
        elif up=="C": x,y=vals[4]+ox,vals[5]+oy
        elif up in "SQ": x,y=vals[-2]+ox,vals[-1]+oy
        elif up=="T": x,y=vals[0]+ox,vals[1]+oy
        elif up=="A": x,y=vals[-2]+ox,vals[-1]+oy
        out.append((x,y))
        if up=="M": start=(x,y); cmd="l" if rel else "L"
    return out


def parse_svg(svg: str) -> dict:
    root=ET.fromstring(svg)
    vb=root.attrib.get("viewBox", "")
    nums=[float(x) for x in re.split(r"[ ,]+",vb.strip()) if x]
    paths=[]; ticks=[]
    def walk(node, parent=(1.,0.,0.,1.,0.,0.)):
        local=_matrix(node.attrib.get("transform", ""))
        a,b,c,d,e,f=parent; A,B,C,D,E,F=local
        mat=(a*A+c*B,b*A+d*B,a*C+c*D,b*C+d*D,a*E+c*F+e,b*E+d*F+f)
        kind=_tag(node.tag)
        if kind in ("path","polyline"):
            pts=_path_points(node.attrib.get("d","")) if kind=="path" else [tuple(map(float,re.findall(r"[-+\d.]+",node.attrib.get("points",""))[i:i+2])) for i in range(0,len(re.findall(r"[-+\d.]+",node.attrib.get("points",""))),2)]
            if len(pts)>1:
                aa,bb,cc,dd,ee,ff=mat
                transformed=[(aa*x+cc*y+ee,bb*x+dd*y+ff) for x,y in pts]
                paths.append({"points":transformed,"fill":node.attrib.get("fill","none"),"stroke":node.attrib.get("stroke",""),"class":node.attrib.get("class","")})
        elif kind=="text":
            text="".join(node.itertext()).strip()
            if re.fullmatch(r"[₹$]?\s*[\d,.]+\s*[kK]?",text):
                try:
                    x=float(node.attrib.get("x",0)); y=float(node.attrib.get("y",0)); aa,bb,cc,dd,ee,ff=mat
                    value=text.replace("₹","").replace("$","").replace(",","").strip()
                    mult=1000 if value.lower().endswith("k") else 1
                    ticks.append({"label":text,"value":float(value.rstrip("kK"))*mult,"x":aa*x+cc*y+ee,"y":bb*x+dd*y+ff})
                except ValueError: pass
        for child in node: walk(child,mat)
    walk(root)
    return {"width":root.attrib.get("width"),"height":root.attrib.get("height"),"viewBox":nums or None,"paths":paths,"ticks":ticks}


def calibrate(points: list[tuple[float,float]], ticks: list[dict]) -> tuple[list[float],dict]:
    if len(ticks)<2: raise ValueError("At least two readable Y-axis ticks are required to calibrate estimated prices.")
    ys=[t["y"] for t in ticks]; ps=[t["value"] for t in ticks]
    linear_error=_fit_error(ys,ps,False); log_error=_fit_error(ys,ps,True) if all(p>0 for p in ps) else math.inf
    logscale=log_error < linear_error*0.75
    # Fit all tick labels by least squares.
    values=[math.log(p) if logscale else p for p in ps]
    ym=sum(ys)/len(ys); vm=sum(values)/len(values)
    slope=sum((y-ym)*(v-vm) for y,v in zip(ys,values))/sum((y-ym)**2 for y in ys)
    intercept=vm-slope*ym
    residual=math.sqrt(sum((v-(intercept+slope*y))**2 for y,v in zip(ys,values))/len(ys))
    mapped=[math.exp(intercept+slope*y) if logscale else intercept+slope*y for _,y in points]
    return mapped,{"scale_type":"logarithmic" if logscale else "linear","rmse_transformed":residual,"tick_count":len(ticks),"slope":slope,"intercept":intercept}


def _fit_error(ys,ps,log):
    vals=[math.log(p) if log else p for p in ps]; ym=sum(ys)/len(ys); vm=sum(vals)/len(vals)
    denom=sum((y-ym)**2 for y in ys)
    if not denom:return math.inf
    m=sum((y-ym)*(v-vm) for y,v in zip(ys,vals))/denom; b=vm-m*ym
    return sum((v-b-m*y)**2 for y,v in zip(ys,vals))/len(ys)


def analyze_url(url: str, ltp: Optional[float] = None, timeframe: Optional[str] = None) -> tuple[dict, list[dict]]:
    """Read displayed minute prices by sweeping the rendered Groww chart tooltip."""
    from playwright.sync_api import sync_playwright

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        try:
            page = browser.new_page(viewport={"width": 1440, "height": 1000}, device_scale_factor=1)
            page.goto(url, wait_until="networkidle", timeout=30000)
            page.wait_for_timeout(2000)
            rows = _read_hover_points(page, "")
            if not rows:
                raise RuntimeError("No timestamped prices appeared in the chart hover tooltip")
        finally:
            browser.close()

    analysis = {
        "input_url": url,
        "instrument": parse_instrument(url),
        "observed_at": datetime.now(timezone.utc).isoformat(),
        "current_displayed_ltp": ltp,
        "chart_timeframe": timeframe,
        "svg": None,
        "plot_boundaries": None,
        "axis_ticks": [],
        "scale_type": "displayed tooltip",
        "calibration": None,
        "point_count": len(rows),
        "prices_exact": True,
        "historical_numerical_series_available": True,
        "warnings": [],
    }
    return analysis, rows



def csv_bytes(rows: list[dict]) -> bytes:
    out=io.StringIO(); fields=["timestamp","x_coordinate","y_coordinate","estimated_premium","data_source","confidence"]
    writer=csv.DictWriter(out,fieldnames=fields); writer.writeheader(); writer.writerows(rows)
    return out.getvalue().encode()


def chart_png(rows: list[dict]) -> bytes:
    """Render a compact line chart as PNG without a plotting-library dependency."""
    width,height=900,420
    pixels=bytearray([255,255,255]*width*height)
    def pixel(x,y,color=(48,112,220)):
        if 0<=x<width and 0<=y<height:
            i=(y*width+x)*3; pixels[i:i+3]=bytes(color)
    left,right,top,bottom=70,width-25,25,height-55
    # Light plot border and horizontal guides.
    for x in range(left,right+1): pixel(x,top,(215,220,228)); pixel(x,bottom,(110,120,135))
    for y in range(top,bottom+1): pixel(left,y,(110,120,135)); pixel(right,y,(215,220,228))
    if rows:
        xs=[float(r.get("x_coordinate") if r.get("x_coordinate") is not None else i) for i,r in enumerate(rows)]; ys=[float(r["estimated_premium"]) for r in rows]
        xmin,xmax=min(xs),max(xs); ymin,ymax=min(ys),max(ys)
        if xmax==xmin: xmax=xmin+1
        if ymax==ymin: ymax=ymin+1
        coords=[(round(left+(x-xmin)/(xmax-xmin)*(right-left)),round(bottom-(v-ymin)/(ymax-ymin)*(bottom-top))) for x,v in zip(xs,ys)]
        for (x0,y0),(x1,y1) in zip(coords,coords[1:]):
            dx,dy=abs(x1-x0),abs(y1-y0); sx=1 if x0<x1 else -1; sy=1 if y0<y1 else -1; err=dx-dy
            while True:
                pixel(x0,y0)
                if x0==x1 and y0==y1: break
                e2=2*err
                if e2>-dy: err-=dy; x0+=sx
                if e2<dx: err+=dx; y0+=sy
        for x,y in coords: pixel(x,y,(20,70,160))
    raw=b"".join(b"\x00"+bytes(pixels[y*width*3:(y+1)*width*3]) for y in range(height))
    def chunk(kind,data): return struct.pack(">I",len(data))+kind+data+struct.pack(">I",zlib.crc32(kind+data)&0xffffffff)
    return b"\x89PNG\r\n\x1a\n"+chunk(b"IHDR",struct.pack(">IIBBBBB",width,height,8,2,0,0,0))+chunk(b"IDAT",zlib.compress(raw))+chunk(b"IEND",b"")


def _parse_hover_text(text: str) -> tuple[Optional[str], Optional[float]]:
    time_match = re.search(r"(?<!\d)(\d{1,2}):(\d{2})(?:\s*(AM|PM))?(?!\d)", text, re.I)
    if not time_match:
        return None, None
    hour, minute, meridiem = time_match.groups()
    hour = int(hour)
    if meridiem:
        hour = hour % 12 + (12 if meridiem.upper() == "PM" else 0)
    label = datetime(2000, 1, 1, hour, int(minute)).strftime("%I:%M %p")

    # Clean text by removing the matched time string so numbers in the time aren't parsed as price
    cleaned = text[:time_match.start()] + " " + text[time_match.end():]
    amounts = re.findall(r"₹\s*([\d,]+(?:\.\d+)?)", text)
    if amounts:
        return label, float(amounts[-1].replace(",", ""))

    # Find float or decimal numbers in the cleaned text
    values = re.findall(r"(?:₹\s*)?([0-9]+(?:,[0-9]+)*(?:\.[0-9]+)?)", cleaned)
    for v in values:
        val = v.replace(",", "")
        try:
            f = float(val)
            if f > 0:
                return label, f
        except ValueError:
            pass

    # Fallback: check non-time lines
    lines = [line for line in text.splitlines() if not re.search(r"\d{1,2}:\d{2}", line)]
    fallback_vals = re.findall(r"(?<![\d:])([\d,]+\.\d{1,4})(?!\d)", " ".join(lines))
    return (label, float(fallback_vals[-1].replace(",", ""))) if fallback_vals else (label, None)


def pivot_minute_prices(contracts: list[dict], points: list[dict]) -> dict:
    """Return a wide time-by-contract table with blank cells for missing minutes."""
    columns = ["Time"] + [item["contract_column"] for item in contracts]
    buckets = {}
    for point in points:
        stamp = point.get("timestamp")
        if stamp:
            buckets.setdefault(stamp, {"Time": stamp})[point["contract"]] = point["estimated_premium"]
    rows = [buckets[key] for key in sorted(buckets, key=lambda value: datetime.strptime(value, "%I:%M %p"))]
    return {"columns": columns, "rows": rows}


def _read_hover_points(page, svg_markup: str) -> list[dict]:
    """Sweep the chart and collect minute/value pairs from its visible tooltip."""
    boxes = page.evaluate("""() => Array.from(document.querySelectorAll('svg')).map((svg, index) => {
      const r = svg.getBoundingClientRect();
      return {index, x:r.x, y:r.y, width:r.width, height:r.height};
    }).filter(r => r.width > 350 && r.height > 120 && r.y < 900)""")
    best = max(boxes, key=lambda box: box["width"] * box["height"], default=None)
    if not best:
        boxes = page.evaluate("""() => Array.from(document.querySelectorAll('svg')).map((svg, index) => {
          const r = svg.getBoundingClientRect();
          return {index, x:r.x, y:r.y, width:r.width, height:r.height};
        }).filter(r => r.width > 250 && r.height > 100)""")
        best = max(boxes, key=lambda box: box["width"] * box["height"], default=None)
    if not best:
        return []

    chart = page.locator("svg").nth(best["index"])
    chart.scroll_into_view_if_needed(timeout=15000)
    box = chart.evaluate("""svg => {
      const r = svg.getBoundingClientRect();
      return {x:r.x, y:r.y, width:r.width, height:r.height,
              viewportWidth:innerWidth, viewportHeight:innerHeight};
    }""")
    y = max(1, min(box["viewportHeight"] - 2, box["y"] + box["height"] * 0.5))
    start = max(1, int(box["x"] + 2))
    end = min(int(box["viewportWidth"] - 2), int(box["x"] + box["width"] - 2))
    observed = {}
    for x in range(start, end + 1, 2):
        page.mouse.move(x, y)
        page.wait_for_timeout(15)
        text = page.evaluate(r"""() => {
          const primary = document.querySelector('.contentPrimary.bodySmall');
          if (primary && primary.innerText && primary.innerText.includes('|')) return primary.innerText;
          const nodes = Array.from(document.querySelectorAll('div, span, [role=tooltip],[class*=tooltip i],[class*=crosshair i]'));
          for (const node of nodes) {
            const t = node.innerText || '';
            if (t.includes('|') && /\d+:\d+/.test(t) && t.length < 60) return t;
          }
          const visible = nodes.filter(e => e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden');
          return visible.map(e => e.innerText || e.textContent || '').filter(Boolean).join('\n');
        }""")
        label, price = _parse_hover_text(text)
        if label and price is not None:
            observed[label] = (x - box["x"], y - box["y"], price)
    return [{"timestamp": minute, "x_coordinate": round(x, 2), "y_coordinate": round(y, 2),
             "estimated_premium": round(price, 4), "data_source": "groww_hover_tooltip", "confidence": "displayed"}
            for minute, (x, y, price) in sorted(observed.items(), key=lambda item: datetime.strptime(item[0], "%I:%M %p"))]




def analyze_svg(url: str, svg: str, ltp: Optional[float] = None, timeframe: Optional[str] = None) -> tuple[dict, list[dict]]:
    """Analyze a Groww chart provided as SVG markup.
    Returns a payload compatible with the UI, similar to the OCR version.
    """
    # Parse SVG markup
    parsed = parse_svg(svg)
    # Extract points from the first path (if any)
    points = []
    if parsed.get("paths"):
        points = parsed["paths"][0].get("points", [])
    # Calibrate prices using Y‑axis ticks
    # Calibrate prices using Y‑axis ticks, capture warnings
    warnings: list[str] = []
    try:
        prices, model = calibrate(points, parsed.get("ticks", []))
    except Exception:
        # Fallback: no calibration possible
        prices = []
        model = {"scale_type": "unknown"}
        warnings.append("Insufficient data to calibrate")
    # If no points were extracted, also warn
    if not points:
        warnings.append("No chart points extracted")
    # Build rows – minimal fields for tests
    rows = []
    for i, price in enumerate(prices):
        rows.append({
            "timestamp": f"t{i}",
            "estimated_premium": price,
            "data_source": "svg",
        })
    analysis = {
        "input_url": url,
        "instrument": parse_instrument(url),
        "observed_at": datetime.now(timezone.utc).isoformat(),
        "current_displayed_ltp": ltp,
        "chart_timeframe": timeframe,
        "svg": svg,
        "plot_boundaries": None,
        "axis_ticks": parsed.get("ticks", []),
        "scale_type": model.get("scale_type", "unknown"),
        "calibration": model,
        "point_count": len(points),
        "prices_exact": False,
        "historical_numerical_series_available": False,
        "warnings": warnings,
    }
    return analysis, rows


# OCR and screenshot utilities

def capture_chart_png(url: str, timeout: int = 30) -> bytes:
    """Capture the chart area from the given Groww options page as PNG bytes."""
    from playwright.sync_api import sync_playwright
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        try:
            page = browser.new_page()
            page.goto(url, wait_until="networkidle", timeout=timeout * 1000)
            page.wait_for_timeout(2000)  # allow chart to render
            # Find the SVG chart with reasonable size
            boxes = page.evaluate(
                """() => Array.from(document.querySelectorAll('svg')).map((svg, index) => {
                    const r = svg.getBoundingClientRect();
                    return {index, x: r.x, y: r.y, width: r.width, height: r.height};
                }).filter(r => r.width > 350 && r.height > 120 && r.y < 900)"""
            )
            if not boxes:
                # fallback to any larger SVG
                boxes = page.evaluate(
                    """() => Array.from(document.querySelectorAll('svg')).map((svg, index) => {
                        const r = svg.getBoundingClientRect();
                        return {index, x: r.x, y: r.y, width: r.width, height: r.height};
                    }).filter(r => r.width > 250 && r.height > 100)"""
                )
            if not boxes:
                raise RuntimeError("No suitable chart SVG found for screenshot")
            best = max(boxes, key=lambda b: b['width'] * b['height'])
            chart = page.locator("svg").nth(best["index"])
            chart.scroll_into_view_if_needed(timeout=timeout * 1000)
            page.evaluate("() => document.fonts.ready")
            return chart.screenshot(timeout=timeout * 1000)
        finally:
            browser.close()

def ocr_prices_from_png(png_bytes: bytes) -> list[dict]:
    """Run Tesseract OCR on a PNG image and return rows of timestamp/price."""
    import pytesseract
    from PIL import Image
    image = Image.open(io.BytesIO(png_bytes))
    raw_text = pytesseract.image_to_string(image)
    rows: list[dict] = []
    for line in raw_text.splitlines():
        label, price = _parse_hover_text(line)
        if label and price is not None:
            rows.append({
                "timestamp": label,
                "estimated_premium": price,
                "data_source": "ocr",
                "confidence": "ocr",
            })
    return rows
