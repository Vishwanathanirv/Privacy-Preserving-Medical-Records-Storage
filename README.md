> Built by [Vishwanathan R](https://vishwanathan.dev) · [Portfolio](https://vishwanathan.dev) · [Resume](https://vishwanathan.dev/resume.pdf)

# Privacy-Preserving Medical Records Storage

Hides encrypted patient records inside CT scans using CNN-based reversible watermarking, with role-based access for doctors and patients. Because the watermark is reversible, the original scan can be restored exactly.

- **Tech:** PyTorch, SQLite, cryptography, Streamlit (`finalapp.py`)
- **Results:** 100% success across encryption, decryption and unauthorised-access tests, about 5 s per record, and support for up to 200 MB images

See the `Screenshots` folder for the app.
