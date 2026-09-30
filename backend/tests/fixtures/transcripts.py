"""Appendix A3 test transcripts."""

from app.services.samples import SAMPLES

T1, T2, T3, T4 = (SAMPLES[i]["text"] for i in (1, 2, 3, 4))
