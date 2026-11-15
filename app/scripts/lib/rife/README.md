RIFE v4.25 inference architecture (MIT, hzwer).

Source mirror: https://huggingface.co/MonsterMMORPG/Practical-RIFE/blob/main/train_log/IFNet_HDv3.py
Upstream: https://github.com/hzwer/Practical-RIFE

Unmodified IFNet_HDv3.py; teacher/time-estimator weights are training only and are excluded by the caller. The wrapper uses safe `torch.load(weights_only=True)` and strict loading of every inference weight.

Checkpoint (not shipped to browsers): `train_log/flownet.pkl`, 24,636,301 bytes.
SHA256: 6615790efd627772917205db291f51cd392528a157ecbb2ecaeec3bff8eb6de2

`smooth-corgi-toon.py --rife-dir DIR` requires this file and checkpoint named `model.pkl` in DIR. The implementation clamps sampling coordinates to reproduce border padding on Apple MPS. No model or Python dependency is needed when running the web app.
