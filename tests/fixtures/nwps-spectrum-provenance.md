# NOAA directional-spectrum parser fixture

`nwps-chshb-20261021-12.spc` is the header and first two complete hourly blocks (12Z and 13Z) from:

https://nomads.ncep.noaa.gov/pub/data/nccf/com/nwps/prod/er.20261021/chs/12/CG1/nwps.t12z.spc2d_CHSHB_CG1.chs.txt

Read from the public NOAA text response on October 21, 2026. The source line-number prefixes were removed; these are lines 0–169 of the retrieved text, with a final newline. SHA-256 of this excerpt: `7bd5c2b6e8ced04597b390ef4135fbae765f931564434194ccbafeb7d997a247`. This is an excerpt hash, not a hash of the full upstream file. No browser authentication was used. No runtime fallback uses the fixture.

Header: SWAN v1 format, model version 41.10, one point at longitude 280.160004 / latitude 32.730000; 37 absolute-frequency bins, 36 nautical direction bins; variance density m²/Hz/degree. Negative direction labels are valid circular angles. The scale after FACTOR multiplies the matrix values; -99 is the missing marker.

Format: https://swanmodel.sourceforge.io/online_doc/swanuse/node50.html

The fixture represents model output near Charleston Harbor, not Folly beach observations. Synthetic analytical fields in `wave-spectrum.test.js` and the entirely synthetic study datasets in `wave-study.test.js` only test numerical behavior and data-leakage protection.
