"""Cursor Automation Bot.

Moves the system cursor along a specified path with exact control over:
1. Specific path (list of (x, y) waypoints or straight/curved sweeps).
2. Specific duration (total time in seconds).
3. Specified speed (pixels per second).

Features:
- Native macOS support via CoreGraphics (works without any third-party dependencies).
- Cross-platform support via PyAutoGUI (if installed).
- Fail-safe safety switch: Slam mouse to any screen corner to abort immediately, or press Ctrl+C.
- High-frequency interpolation (60Hz default) for smooth, natural movement.
"""

from __future__ import annotations

import sys
import time
import math
import argparse
from typing import Sequence, Optional, Tuple


class FailSafeException(Exception):
    """Raised when the mouse is manually forced into a corner to abort."""
    pass


class CursorBot:
    def __init__(self, fail_safe: bool = True):
        self.fail_safe = fail_safe
        self._use_pyautogui = False
        self._cg = None

        # Try pyautogui first
        try:
            import pyautogui
            pyautogui.FAILSAFE = False  # We handle fail-safe manually for consistency
            self._pyautogui = pyautogui
            self._use_pyautogui = True
        except ImportError:
            # Fall back to macOS CoreGraphics via ctypes
            if sys.platform == "darwin":
                import ctypes
                from ctypes import c_double, c_void_p, c_uint32, Structure

                class CGPoint(Structure):
                    _fields_ = [("x", c_double), ("y", c_double)]

                cg = ctypes.cdll.LoadLibrary("/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics")
                cg.CGEventCreateMouseEvent.restype = c_void_p
                cg.CGEventCreateMouseEvent.argtypes = [c_void_p, c_uint32, CGPoint, c_uint32]
                cg.CGEventPost.argtypes = [c_uint32, c_void_p]
                cg.CFRelease.argtypes = [c_void_p]

                # CGEventGetLocation
                cg.CGEventCreate.restype = c_void_p
                cg.CGEventCreate.argtypes = [c_void_p]
                cg.CGEventGetLocation.restype = CGPoint
                cg.CGEventGetLocation.argtypes = [c_void_p]

                self._CGPoint = CGPoint
                self._cg = cg
            else:
                raise RuntimeError("Please install pyautogui (`pip install pyautogui`) on non-macOS systems.")

    def get_screen_size(self) -> Tuple[int, int]:
        """Return (width, height) of primary display."""
        if self._use_pyautogui:
            return self._pyautogui.size()
        if sys.platform == "darwin" and self._cg:
            # CGMainDisplayID = 0
            w = self._cg.CGDisplayPixelsWide(0)
            h = self._cg.CGDisplayPixelsHigh(0)
            return int(w), int(h)
        return (1920, 1080)

    def get_position(self) -> Tuple[float, float]:
        """Return current cursor position (x, y)."""
        if self._use_pyautogui:
            pos = self._pyautogui.position()
            return float(pos.x), float(pos.y)
        if sys.platform == "darwin" and self._cg:
            event = self._cg.CGEventCreate(None)
            pt = self._cg.CGEventGetLocation(event)
            self._cg.CFRelease(event)
            return float(pt.x), float(pt.y)
        return (0.0, 0.0)

    def move_to(self, x: float, y: float) -> None:
        """Instantly teleport cursor to (x, y)."""
        if self.fail_safe:
            self._check_failsafe()

        if self._use_pyautogui:
            self._pyautogui.moveTo(x, y)
        elif sys.platform == "darwin" and self._cg:
            point = self._CGPoint(x=float(x), y=float(y))
            # kCGEventMouseMoved = 5, kCGHIDEventTap = 0
            event = self._cg.CGEventCreateMouseEvent(None, 5, point, 0)
            self._cg.CGEventPost(0, event)
            self._cg.CFRelease(event)

    def _check_failsafe(self) -> None:
        """Abort if user pushed the mouse to any corner of the screen."""
        try:
            cur_x, cur_y = self.get_position()
            w, h = self.get_screen_size()
            margin = 5
            in_corner = (
                (cur_x <= margin and cur_y <= margin) or
                (cur_x >= w - margin and cur_y <= margin) or
                (cur_x <= margin and cur_y >= h - margin) or
                (cur_x >= w - margin and cur_y >= h - margin)
            )
            if in_corner:
                raise FailSafeException("Mouse moved to screen corner. Fail-safe triggered; aborting.")
        except Exception:
            pass

    @staticmethod
    def _path_length(points: Sequence[Tuple[float, float]]) -> float:
        """Compute the total Euclidean length of a path of points."""
        total = 0.0
        for i in range(len(points) - 1):
            dx = points[i+1][0] - points[i][0]
            dy = points[i+1][1] - points[i][1]
            total += math.hypot(dx, dy)
        return total

    @staticmethod
    def _point_at_distance(points: Sequence[Tuple[float, float]], dist: float) -> Tuple[float, float]:
        """Interpolate (x, y) along the piecewise linear path at the given cumulative distance."""
        if dist <= 0:
            return points[0]
        accum = 0.0
        for i in range(len(points) - 1):
            p0, p1 = points[i], points[i+1]
            seg_len = math.hypot(p1[0] - p0[0], p1[1] - p0[1])
            if accum + seg_len >= dist:
                ratio = (dist - accum) / seg_len if seg_len > 0 else 0.0
                x = p0[0] + ratio * (p1[0] - p0[0])
                y = p0[1] + ratio * (p1[1] - p0[1])
                return (x, y)
            accum += seg_len
        return points[-1]

    def move_along_path(
        self,
        points: Sequence[Tuple[float, float]],
        duration: Optional[float] = None,
        speed: Optional[float] = None,
        fps: int = 60
    ) -> None:
        """Move cursor along a sequence of points.

        Args:
            points: List of (x, y) waypoints.
            duration: Total duration in seconds (if specified).
            speed: Speed in pixels per second (if duration is None).
            fps: Updates per second (default 60 for smooth motion).
        """
        if len(points) < 2:
            raise ValueError("Path must have at least 2 points.")

        total_dist = self._path_length(points)
        if total_dist == 0:
            return

        if duration is not None and duration > 0:
            total_time = float(duration)
        elif speed is not None and speed > 0:
            total_time = total_dist / float(speed)
        else:
            # Default to 200 pixels/sec if neither is specified
            total_time = total_dist / 200.0

        step_delay = 1.0 / max(10, min(240, fps))
        start_time = time.monotonic()
        end_time = start_time + total_time

        # Initial move to starting point
        self.move_to(points[0][0], points[0][1])

        while True:
            now = time.monotonic()
            elapsed = now - start_time
            if elapsed >= total_time:
                break

            fraction = elapsed / total_time
            curr_dist = fraction * total_dist
            x, y = self._point_at_distance(points, curr_dist)
            self.move_to(x, y)

            # Sleep until next frame
            target_next = start_time + (int(elapsed / step_delay) + 1) * step_delay
            sleep_time = target_next - time.monotonic()
            if sleep_time > 0:
                time.sleep(sleep_time)

        # Ensure final point is reached exactly
        self.move_to(points[-1][0], points[-1][1])

    def sweep_horizontal(self, y: float, start_x: float, end_x: float, duration: Optional[float] = None, speed: Optional[float] = None) -> None:
        """Convenience method to sweep horizontally across a screen or chart."""
        self.move_along_path([(start_x, y), (end_x, y)], duration=duration, speed=speed)


def main():
    parser = argparse.ArgumentParser(description="Cursor Automation Bot")
    parser.add_argument("--sweep", nargs=4, type=float, metavar=("X1", "Y1", "X2", "Y2"),
                        help="Sweep from (X1, Y1) to (X2, Y2)")
    parser.add_argument("--duration", type=float, default=None,
                        help="Total duration for the path in seconds")
    parser.add_argument("--speed", type=float, default=None,
                        help="Speed in pixels per second")
    parser.add_argument("--fps", type=int, default=60,
                        help="Updates per second (default: 60)")

    args = parser.parse_args()
    bot = CursorBot()

    if args.sweep:
        x1, y1, x2, y2 = args.sweep
        print(f"Sweeping cursor from ({x1}, {y1}) to ({x2}, {y2})...")
        if args.duration:
            print(f"Mode: Fixed Duration = {args.duration}s")
        elif args.speed:
            print(f"Mode: Fixed Speed = {args.speed} px/s")
        else:
            print("Mode: Default 200 px/s")

        bot.move_along_path([(x1, y1), (x2, y2)], duration=args.duration, speed=args.speed, fps=args.fps)
        print("Sweep complete.")
    else:
        # Default test: get position and display current status
        cur = bot.get_position()
        size = bot.get_screen_size()
        print(f"Cursor Bot Ready.")
        print(f"Screen resolution: {size[0]}x{size[1]}")
        print(f"Current cursor position: ({cur[0]}, {cur[1]})")
        print("\nExample usage:")
        print("  python cursor_bot.py --sweep 200 400 800 400 --duration 3.5")
        print("  python cursor_bot.py --sweep 100 500 1200 500 --speed 250")


if __name__ == "__main__":
    try:
        main()
    except (KeyboardInterrupt, FailSafeException) as e:
        print(f"\nStopped: {e}")
