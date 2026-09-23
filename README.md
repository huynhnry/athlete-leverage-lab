# Athlete Leverage Lab

Interactive anthropometry-driven strength biomechanics simulator.

## Current milestone

The current build focuses on getting the foundation right before enabling a muscle heatmap:

- real rigged human mesh rather than a procedural cylinder mannequin
- direct use of torso, femur, tibia, upper-arm, forearm, shoulder-width, and hip-width measurements
- hard vertical bar constraint for high-bar and low-bar squats
- visible bar travel path
- squat depth target around hip crease = knee height
- one continuous deadlift stance control from conventional-like to sumo-like, with grip moving inside the legs as stance widens
- bench model with a 30 cm × 122 cm pad and two-link arm IK
- live external joint-moment proxies that change when anthropometry changes

The muscle heatmap is intentionally disabled until the anatomical model and movement mechanics are visually validated. The current mechanics are transparent external-moment estimates, not measured individual muscle forces.

## Development

The project is a static ES-module site. No build step is required.

## Deployment

GitHub Pages deploys from `.github/workflows/deploy.yml` after Pages is configured to use **GitHub Actions** as its source.

Expected site URL:

`https://huynhnry.github.io/athlete-leverage-lab/`

## 3D model

The browser loads the CC0 MakeHuman/MPFB2-based parametric base from `nirholas/three.ws`, pinned to commit `482a12381caeb4122e2444cf8727a476f2c4dfc2`. The source model provides a Mixamo-style rig and body morph targets.
