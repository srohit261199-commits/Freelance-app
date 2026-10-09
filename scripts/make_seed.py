"""Build src/main/seed/waveink-tech.json from Waveink's "Tech_Products Designer.xlsx".

Usage: python3 scripts/make_seed.py path/to/Tech_Products_Designer.xlsx
The catalog itself is not committed; only the trimmed product list the app needs.
"""
import json
import sys
from pathlib import Path

import openpyxl

OUT = Path(__file__).resolve().parent.parent / "src" / "main" / "seed" / "waveink-tech.json"


def rows(ws):
    it = ws.iter_rows(values_only=True)
    head = [str(h).strip() if h is not None else "" for h in next(it)]
    for r in it:
        if not r or not r[0]:
            continue
        yield {head[i]: r[i] for i in range(len(head)) if head[i]}


def clean(v):
    if v is None:
        return ""
    if isinstance(v, float) and v.is_integer():
        return str(int(v))
    return str(v).strip()


def main(path):
    wb = openpyxl.load_workbook(path, data_only=True)
    # The same product is listed once per subcategory it belongs to (284 rows, 199 codes);
    # one 3D model covers all of its rows, so rows are folded into one product per code.
    status, print_area = {}, {}
    for name, flag in (("Has Print Area", True), ("No Print Area", False)):
        for r in rows(wb[name]):
            code = clean(r.get("Jasani Code"))
            s = clean(r.get("3D Model Status")).lower()
            if s and (not status.get(code) or s.startswith("done")):
                status[code] = s
            print_area[code] = flag

    products, by_code = [], {}
    for order, r in enumerate(rows(wb["Tech All"])):
        code = clean(r.get("Jasani Code"))
        sub = clean(r.get("Subcategory"))
        if code in by_code:
            p = by_code[code]
            p["rows"].append(order)
            if sub and sub not in p["subcategories"]:
                p["subcategories"].append(sub)
            continue
        urls = [clean(r.get(f"Source URL {i}")) for i in range(1, 15)]
        raw = status.get(code, "")
        p = {
            "name": clean(r.get("Product Name")),
            "code": code,
            "jasaniId": clean(r.get("Jasani ID")),
            "templateId": clean(r.get("Template ID (backend files)")),
            "brand": clean(r.get("Brand")),
            "colour": clean(r.get("Colour")),
            "category": clean(r.get("Category")) or "Tech",
            "subcategories": [sub] if sub else [],
            "description": clean(r.get("Description")),
            "printMethods": clean(r.get("Supplier Methods (real)")),
            "brandingAreas": clean(r.get("Branding Areas — position · physical size · methods")),
            "areas": clean(r.get("# Areas")),
            "variants": clean(r.get("Colour / Size Variants (code — variant)")),
            "hasPrintArea": print_area.get(code, True),
            "catalogStatus": raw,
            "sourceUrls": [u for u in urls if u],
            "rows": [order],
        }
        by_code[code] = p
        products.append(p)
    OUT.write_text(json.dumps(products, ensure_ascii=False, indent=1))
    done = sum(1 for p in products if p["catalogStatus"].startswith("done"))
    print(f"wrote {len(products)} products from {order + 1} rows ({done} marked done) to {OUT}")


if __name__ == "__main__":
    main(sys.argv[1])
