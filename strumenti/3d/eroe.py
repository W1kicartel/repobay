# Hero: laptop + developer (left), box travelling on a dashed arc (centre), shop + installer (right), coins above.
#   Blender -b -P eroe.py -- [prova]
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import scena as S
from mathutils import Vector, Quaternion

SR = Vector((0.7071, 0.7071, 0))   # screen right
TC = Vector((0.7071, -0.7071, 0))  # towards the camera


def P(sr, tc, z=0.0):
    return SR * sr + TC * tc + Vector((0, 0, z))


def costruisci():
    S.portatile(P(-4.0, -0.2), math.radians(62), 1.6)
    S.figura('dev', 'in_piedi', P(-6.35, 1.0), math.radians(68), 1.2,
             mano_d=(0.62, -0.18, 1.72), mano_s=(-0.78, -0.35, 1.05))
    # dashed arc: from the laptop screen to the installer
    A = P(-3.1, -0.6, 2.35)
    B = P(1.55, 2.25, 1.75)
    pts = S.arc_points(A, B, 2.6, 60)
    S.tratteggio(pts, 0.045, 'inchiostro', 2, 2)
    # the box on the arc
    t = 0.47
    i = int(t * 60)
    p = pts[i]
    S.scatola(p + Vector((0, 0, 0.06)), (0, 0, 0), 1.25)
    box = [o for o in S.bpy.context.scene.objects if o.name.startswith('scatola')][-1]
    box.rotation_mode = 'QUATERNION'
    box.rotation_quaternion = Quaternion(TC, math.radians(-9)) @ Quaternion((0, 0, 1), math.radians(4))
    # speed lines behind the box
    for k, dz in enumerate((0.25, 0.65, 1.0)):
        a = p - SR * (1.05 + 0.15 * k) + Vector((0, 0, dz + 0.05))
        S.capsule(a, a - SR * (0.5 - 0.1 * k), 0.035, 'inchiostro')
    # shop + installer at the door
    S.negozio(P(4.4, -0.9), math.radians(26), 1.05)
    S.figura('inst', 'in_piedi', P(2.05, 2.15), math.radians(30), 1.2,
             mano_s=(-0.7, -0.25, 1.7))
    # jumping coins: from the shop back up towards the builder
    S.moneta(P(3.6, -1.0, 4.3), (math.radians(65), math.radians(20), math.radians(35)), 'menta', scale=1.2)
    S.moneta(P(1.9, -1.5, 5.3), (math.radians(50), math.radians(-30), math.radians(5)), 'cobalto', scale=1.2)
    # hop arcs: shop roof -> mint -> cobalt -> orange (money going back to the builder)
    hops = [P(4.0, -0.4, 3.35), P(3.6, -1.0, 3.75), P(1.9, -1.5, 4.75), P(0.0, -2.0, 5.2)]
    for h0, h1 in zip(hops[1:-1], hops[2:]):
        S.tratteggio(S.arc_points(h0, h1, 0.9, 24)[6:-5], 0.03, 'inchiostro', 2, 2)  # trimmed: no dash inside the coins
    S.moneta(P(0.0, -2.0, 5.75), (math.radians(78), math.radians(30), math.radians(65)), 'segnale', scale=1.2)

if __name__ == '__main__':
    prova = 'prova' in S.args()
    S.reset()
    costruisci()
    S.pavimento()
    S.luci()
    cam = S.camera()
    res = (2400, 1600)
    S.inquadra(cam, res, 0.05)
    S.render('eroe.png', res, samples=64, prova=prova)
