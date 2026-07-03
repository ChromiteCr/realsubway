"""网格框架:三个数据产物共用同一个地理范围与分辨率。

范围覆盖北京六环及两座机场(大兴机场 39.509N,首都机场 40.078N)。
"""

LNG_MIN = 116.00
LNG_MAX = 116.80
LAT_MIN = 39.46
LAT_MAX = 40.22

WIDTH = 512
HEIGHT = 512

# 行主序,第 0 行是北边(图像惯例):row=0 -> LAT_MAX
def frame_meta() -> dict:
    return {
        "bbox": {"lngMin": LNG_MIN, "latMin": LAT_MIN, "lngMax": LNG_MAX, "latMax": LAT_MAX},
        "width": WIDTH,
        "height": HEIGHT,
        "dtype": "uint16",
        "order": "row-major, row 0 = north",
    }
