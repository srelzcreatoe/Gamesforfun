"""Shin Godzilla 3rd form ("Shinagawa-kun"): the first time it rises onto its
hind legs.  Same anatomy plan as the 4th form but half the size, hunched
forward, with gills still on the neck, larger eyes, stubby half-formed arms
and smaller, pale grey dorsal plates.  Texture palette is red-brown."""
import form4


def build(seed=3):
    return form4.build(seed=seed, form=3)


def anchors(m):
    return form4.anchors(m, 0.5)
