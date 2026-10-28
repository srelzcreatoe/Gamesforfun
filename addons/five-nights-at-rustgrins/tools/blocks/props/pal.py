"""Shared material ramps (dark -> light) for the props. Desaturated and grimy, after
docs/DESIGN.md §1. PBR intent: metal (R), emissive (G), roughness (B), height."""
from propkit import Mat, solid

# metals
STEEL = Mat('steel', ['#2b2f34', '#3b4046', '#4d5359', '#60666d', '#747a81', '#898f95', '#a0a5aa'], metal=180, rough=125, h=140, hk=4)
GALV = Mat('galv', ['#363a40', '#474c53', '#5a6067', '#6e747b', '#848a90', '#9aa0a5', '#b0b5b9'], metal=200, rough=115, h=140, hk=4)
IRON = Mat('iron_dark', ['#101113', '#17191c', '#202328', '#2a2e34', '#363b42', '#444a52'], metal=170, rough=150, h=135, hk=4)
CHROME = Mat('chrome', ['#25282c', '#3f4449', '#62686f', '#8b9198', '#b6bcc2', '#dde1e5'], metal=235, rough=55, h=150, hk=3)
RUST = Mat('rust', ['#2a1810', '#3d2314', '#55301a', '#6c3f21', '#82512b', '#956436'], metal=40, rough=235, h=136, hk=6)
BRASS = Mat('brass', ['#3a2a0e', '#574016', '#76591f', '#957329', '#b08d3a', '#c9a650'], metal=210, rough=95, h=140, hk=3)

# plastics / paints
BEIGE = Mat('beige', ['#433d31', '#575040', '#6c6451', '#817863', '#958b74', '#a69c84', '#b6ac92'], metal=0, rough=150, h=140, hk=3)
GREYPLAST = Mat('greyplast', ['#2b2c2e', '#3a3b3e', '#4a4b4f', '#5b5d61', '#6d6f74', '#808287'], metal=0, rough=160, h=140, hk=3)
BLACK = Mat('black', ['#0c0c0e', '#131316', '#1a1a1e', '#222227', '#2c2c32', '#37373e'], metal=0, rough=170, h=138, hk=3)
RED = Mat('red', ['#2a0a0a', '#420e0e', '#5a1414', '#731c1b', '#8b2824', '#a2372f'], metal=0, rough=120, h=140, hk=3)
RED_GLOW = Mat('red_glow', ['#8a1a12', '#b52818', '#dc3a22', '#f45a3a', '#ff8a66', '#ffc0a0'], metal=0, rough=90,
               emit=[150, 190, 225, 245, 255, 255], h=146, hk=2)
WHITE = Mat('white_plast', ['#55534d', '#6c6a63', '#85827a', '#9c9890', '#b0aca2', '#c2beb3'], metal=0, rough=110, h=140, hk=3)
WHITE_GLOW = Mat('white_glow', ['#a7aab0', '#c5c9cf', '#dde1e6', '#eef1f5', '#fafcff', '#ffffff'], metal=0, rough=80,
                 emit=[170, 205, 230, 250, 255, 255], h=146, hk=2)
YELLOW = Mat('yellow', ['#3e2f0c', '#5a4410', '#7a5c15', '#9a771c', '#b48f26', '#c9a436', '#d7b54c'], metal=0, rough=135, h=140, hk=3)
CERAMIC = Mat('ceramic', ['#4f4b43', '#67625a', '#7f7a70', '#958f84', '#a8a296', '#b8b2a5', '#c6c0b2'], metal=0, rough=70, h=142, hk=3)
GOLD = Mat('gold_paint', ['#33250c', '#4f3912', '#6d5019', '#8c6a22', '#a8822c', '#c19a3b', '#d6b257'], metal=120, rough=120, h=140, hk=4)
PURPLE_PAINT = Mat('purple_paint', ['#1a0f22', '#26162f', '#331e3f', '#42284f'], metal=0, rough=190, h=136, hk=3)

# organics / fabric / paper
CARD = Mat('cardboard', ['#35251a', '#4a3421', '#5e4429', '#715332', '#83633b', '#937246'], metal=0, rough=225, h=138, hk=4)
PAPER = Mat('paper', ['#6f695e', '#878073', '#9d9686', '#b0a896', '#c0b8a5', '#cdc5b2'], metal=0, rough=230, h=136, hk=2)
GRILLE = Mat('grille', ['#08080a', '#0e0e11', '#141418', '#1b1b20', '#232329', '#2c2c33'], metal=0, rough=245, h=120, hk=6)
TOLEX = Mat('tolex', ['#080c09', '#0d1410', '#131c16', '#1a261d', '#213125', '#2a3d2f'], metal=0, rough=200, h=138, hk=5)
WOOD = Mat('wood_dark', ['#20160c', '#2d1f11', '#3b2917', '#49331d', '#573d23', '#654729'], metal=0, rough=200, h=136, hk=5)
CLOTH = Mat('cloth', ['#57534b', '#6d685e', '#837e72', '#979184', '#a8a294', '#b6b0a1'], metal=0, rough=240, h=136, hk=3)
CLOTH_RED = Mat('cloth_red', ['#2c0c0c', '#401111', '#561818', '#6b2020', '#7f2a28'], metal=0, rough=240, h=136, hk=3)
PLUSH = Mat('plush', ['#20111c', '#2c1827', '#3a2033', '#482940', '#57334e', '#673e5d'], metal=0, rough=250, h=138, hk=6)
LILAC = Mat('lilac', ['#5a4656', '#6f5a6a', '#85707f', '#9a8594', '#ad99a7', '#bca9b6'], metal=0, rough=250, h=140, hk=5)
PINK = Mat('pink', ['#5a2636', '#743345', '#8f4558', '#a85a6c', '#bd7182'], metal=0, rough=220, h=140, hk=4)

# glass / screens
GLASS_OFF = Mat('glass_off', ['#050607', '#090b0d', '#0e1214', '#15191c', '#1f2529', '#2e363b', '#46525a'], metal=0, rough=25, h=128, hk=1)
STATIC = Mat('static', ['#0c2224', '#123433', '#1a4744', '#245b55', '#337066', '#478779', '#62a08f', '#86b9a8'], metal=0, rough=30,
             emit=[60, 90, 120, 150, 180, 205, 230, 250], h=128, hk=1)
LED_GREEN = solid('led_green', '#5cff6a', emit=255, rough=60, h=150)
LED_YELLOW = solid('led_yellow', '#ffd640', emit=255, rough=60, h=150)
LED_RED = solid('led_red', '#ff3a2a', emit=255, rough=60, h=150)
LED_OFF_G = solid('led_off_g', '#1d3320', rough=60, h=146)
LED_OFF_Y = solid('led_off_y', '#3a3317', rough=60, h=146)
LED_OFF_R = solid('led_off_r', '#3a1714', rough=60, h=146)
SHADOW = Mat('shadow', ['#050505', '#0a0a0b', '#111113'], metal=0, rough=240, h=100, hk=4)
GRIME = Mat('grime', ['#1e1a14', '#2b251c', '#3a3226', '#4b4234', '#5a5040'], metal=0, rough=245, h=132, hk=2)
WATER = Mat('water_dirty', ['#1d211e', '#262b27', '#303630', '#3b423a', '#4a5248'], metal=0, rough=20, h=126, hk=1)
