# Sample images

Real, openly licensed medical images, used by `npm run benchmark` (results in [docs/measurements.md](../docs/measurements.md)) and by the live demo's walkthrough and seeded records. `npm run samples` downloads every source again, checks it against the SHA-256 below and rebuilds the PNG.

They are anonymised, publicly published research images. They show no one known to this project, and the clinical notes the demo attaches to them are fictional.

| File | What it is | Source | Licence | Changes made |
| --- | --- | --- | --- | --- |
| `chest-xray-pa-1.png` | Chest X-ray, PA view, 1000×1000, 8-bit | Image `2168a917.jpg` from the COVID-19 image repository of the Institute for Diagnostic and Interventional Radiology, Hannover Medical School (Winther H. et al., figshare, doi:10.6084/m9.figshare.12275009), as redistributed in the COVID-19 image data collection (Cohen J. P. et al., 2020) | [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/) | Decoded from JPEG, converted to grayscale, downscaled 2× with a box filter |
| `chest-xray-pa-2.png` | Chest X-ray, PA view, 1000×1000, 8-bit | Image `5f619d7e.jpg`, same repository and attribution as above | [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/) | Same as above |
| `brain-mri-t1.png` | Brain MRI, T1-weighted, one slice, 160×192, 16-bit (10 bits used) | `sub-01_T1w.nii.gz` from OpenNeuro dataset ds000001 v1.0.0, "Balloon Analog Risk-taking Task" (Schonberg T. et al., 2012, doi:10.18112/openneuro.ds000001.v1.0.0) | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | Middle slice extracted at full precision, flipped upright |

Source checksums (SHA-256):

- `2168a917.jpg`: `a3f57a6cafe8be6da7b234db9205bace6a4158154bd4e228544b4a8e5cd008b3`
- `5f619d7e.jpg`: `13870f4897c7542d0deac2e8f447a230023a2970b5998cc9f70a73ded6cf2311`
- `sub-01_T1w.nii.gz`: `bdb7022ae229c5b8edd16425928c9243c562f84082b9b8e6f97cdba8b9354a98`
