The two spectra fixtures are the public NOAA NDBC station 41004 rows observed 2026-10-21 02:20 UTC, read directly in the browser on 2026-10-21 from:

- https://www.ndbc.noaa.gov/data/realtime2/41004.data_spec
- https://www.ndbc.noaa.gov/data/realtime2/41004.swdir

They are test fixtures, never runtime fallback data. No browser authentication was used.

Format and units: https://www.ndbc.noaa.gov/faq/measdes.shtml
Density C11 is in m²/Hz. Alpha1 is the mean wave direction, clockwise from true north, describing where waves come from. Alpha2 is principal direction; R1 and R2 are nondimensional first and second normalized polar Fourier coordinates. This implementation uses only C11 and alpha1 and does not reconstruct directional spreading. Missing density/direction is 999; missing separation frequency is 9.999. Separation frequency is not used by this endpoint.

QC status: https://www.ndbc.noaa.gov/station_realtime.php?station=41004
Realtime data have preliminary checks and are not the final historical archive. Observations remain offshore measurements, not a validated prediction of breaking surf or surf quality.
