# Minimal stub for bs4 package to satisfy imports in the project.
# Provides a simple BeautifulSoup class with basic methods used in the code.

class BeautifulSoup:
    def __init__(self, html: str = "", parser: str = "html.parser"):
        self.html = html
        self.parser = parser

    def select(self, selector: str):
        # Return an empty list; actual parsing is not required for the fallback.
        return []

    def select_one(self, selector: str):
        return None

    def get_text(self, *args, **kwargs):
        return ""
