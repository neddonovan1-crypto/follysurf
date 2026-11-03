# Folly-specific evidence and calibration plan

Reviewed 21 October 2026 UTC. This catalog distinguishes implemented collection/evaluation tools, measured beach evidence, physical modeling and research still requiring access or observations. Current operational instructions live in the linked workflow documents; a deployed collector does not establish a successful scheduled run without its saved heartbeat. No source here validates the surf-quality score or supplies fitted corrections. Public source access was checked; no agency was contacted and no account was created.

## What a Folly-specific model can learn

Focusing on one consistently defined stretch of beach is useful: local orientation, seabed shape, structures, water level, incoming waves and wind can be joined to observations of the same breaking waves. It does not make all of Folly one interchangeable surf spot, and it does not remove the need for observed outcomes.

| Driver | Evidence and confidence | Consequence for this app |
| --- | --- | --- |
| Shoreline orientation and location | The City's 2021 plan describes the island as generally northeast–southwest. Its measured profiles distinguish the pier, southwest beach, northeast/Washout region and inlet ends. | Compute a documented local shore normal for each spot from georeferenced geometry. A single island-wide bearing is an approximation. |
| Changing beach and seabed | Repeated state beach/nearshore profiles are real measurements. The City's profile analysis describes different erosion and sand-retention behavior in different regions. | Preserve survey date and position. Do not treat a historical grid as today's sandbars or infer an unmeasured alongshore bar shape from sparse transects. |
| Nourishment and structures | The City documents groins, inlet shoals and nourishment history; USACE reports a major 2024 sand-placement project. | Track these as changes in beach geometry. Old imagery and newer forecasts can belong to different beach configurations. |
| Swell, tide, currents and wind | Folly-specific research models transformation of directional wave spectra by bathymetry, currents, wind and dissipation. This is evidence for interacting physical drivers, not an empirically measured optimum surf recipe. | Keep period definitions, wave-direction conventions and water-level datums explicit. Test their interactions against local observations before assigning favorable tide, direction or period bonuses. |
| Rideable shape and consistency | No independently labeled Folly surfing-quality dataset was verified in this review. A wave model's bulk height and peak period do not supply observations of peeling shape, closeouts or ride opportunities. | Continue to describe the score as modeled potential. Do not present a fitted local-quality rating until it has been evaluated against beach observations. |

No reviewed primary source established a universally best tide or a precise optimal swell bearing for present-day Folly surfing. A statement that one location, swell or tide is better needs a specified beach configuration and a defined surfing outcome.

## Verified source catalog

### 1. SC DES BERM: raw Folly profiles are downloadable

- [Official viewer and download entry](https://gis.des.sc.gov/bermexplorer/)
- [Direct Folly ZIP](https://des.sc.gov/sites/des/files/Documents/GIS/FOLLY_BEACH.zip)

The ZIP was successfully downloaded and its CSV, projection and XML metadata inspected. It contains annual CSV/shapefile exports named 2014–2025. The verified source metadata is recorded in `bathymetry-sources.json`. The research importer has now ingested the survey exports into a separate normalized store; they have **not** been converted to a bathymetry raster, fed to a custom wave simulation, or used to change the rating.

The 2025 CSV contains **62,811 points on 31 transects**, all with collection date **13 November 2025**: 4,343 topographic and 58,468 bathymetric points. The 2024 export is dated 20 November 2024. These are survey snapshots, not an hourly seabed feed. Import the actual `COL_DATE`, not the filename: the file named `FOLLY_BEACH_2014.csv` contains **3 October 2013** measurements and `Year=2013`.

The projection files specify **NAD83(2011), South Carolina State Plane FIPS 3900, international feet** (`Foot=0.3048 m`). CSVs include coordinates, elevation, monument/transect identifiers and along-profile distances. Published profile elevations and distances are in feet; viewer volumes are in cubic yards. The importer confirmed explicit **NAVD88 / Geoid12A** metadata only for the 2015 and 2016 exports. Other years remain unconfirmed; a 2021 lineage filename hint is not accepted as datum proof. In particular, the 2025 vertical datum remains unconfirmed. Confirm that before joining newer elevations to water levels. NAVD88, MSL and MLLW are not interchangeable.

The actual import processed **925,274 points across 12 annual exports and 371 survey/transect groups**: 31 groups per export except 2017, which has 30. Collection dates, original numeric text, identifiers, projection files and XML metadata are preserved. Compact manifests, transect summaries, validation results and nourishment provenance are in `research/surveys/`. The tracked `profile-samples.csv.gz` contains 4,573 actual observed points from 2025 (209,347 bytes), not an interpolated surface. Full normalized annual CSV files are gzip-compressed under the ignored `research/surveys/normalized/`; the approximately 45 MB normalized bundle is under ignored `research/surveys/exports/`. The full normalized bundle contains all 925,274 points, original projection/XML metadata and an all-years 51,551-point sample. Its ZIP SHA-256 is `a8aa23e3ea46d62e0c8418abdfb079208762e9d30260430c5001f19fab1d4457`; ZIP integrity, member hashes and the full 2025 roundtrip were verified. Those local outputs are not a claim of public redistribution or durable availability.

Preserve original metadata and profile offsets: BERM explains that relocated monuments and nonidentical survey lines require care when comparing years. Public download access is verified; an explicit redistribution license for the ZIP was not identified. Credit SC DES and retain its metadata/disclaimer. Retrieved archive SHA-256: `1a1edc05953e0580e2ce8857f699caa5f320cfa3d2312e19687b128e8121987f`. Do not commit the large raw archive to the application repository.

### 2. City beachfront plan: measured differences within Folly

[City of Folly Beach Local Comprehensive Beachfront Management Plan, adopted 13 July 2021](https://des.sc.gov/sites/des/files/media/document/OCRM_FollyBeachLCBMP2021.pdf), particularly printed pages 40–55.

The plan identifies 31 permanent profile monuments and summarizes BERM, Coastal Carolina University and Elko survey records. It documents longer historical coverage than the current ZIP: some pier/northeast profiles extend to 1988 and southwest profiles to 1998. Those older raw records were not retrieved.

Representative profiles include 2815 southwest, 2828 near Center Street/pier, 2865 northeast/Washout and 2890 toward Lighthouse Inlet. Their histories differ. The report associates retained nourished sand near the center with rehabilitated groins, describes northeast erosion, and documents inlet-shoal attachment. These are observations and interpretations of coastal morphology, not comparisons of surfing quality.

### 3. USACE: a documented change in beach geometry

[Federal projects help protect South Carolina's coastline, USACE Charleston District, 20 May 2025](https://www.sac.usace.army.mil/Media/News-Stories/Article/4193231/federal-projects-help-protect-south-carolinas-coastline/).

The retrospective reports Folly work beginning in March 2024 and completion by October 2024, with **1.7 million cubic yards** placed. Use this completed-project figure rather than an earlier contract's planned amount. The November 2024 and November 2025 BERM surveys are after that intervention. The older pier-camera archive below is before it. Treat this as a known change in terrain when designing validation splits; it does not prove that surfing improved or worsened.

The official article's indexed text was retrievable; direct article opening returned HTTP 403 in this research environment. This is a verified published report, not a successfully tested machine-readable ingestion endpoint.

### 4. Folly-specific academic and instrument evidence

[Work, P. A., Fehrenbacher, F., and Voulgaris, G. (2004), “Nearshore Impacts of Dredging for Beach Nourishment,” Journal of Waterway, Port, Coastal, and Ocean Engineering 130(6), 303–311](https://ascelibrary.org/doi/abs/10.1061/%28ASCE%290733-950X%282004%29130%3A6%28303%29?download=true). DOI: `10.1061/(ASCE)0733-950X(2004)130:6(303)`.

The publisher abstract identifies Folly Island as the SWAN test case and includes directional spectra, currents, bathymetry, wind and dissipation. Its tidal-flow model was calibrated against field measurements. Only the abstract was accessible here; full text returned HTTP 403. It supports investigating local wave transformation, not any particular surf-score coefficient or claim of present-day forecast accuracy.

[University of South Carolina legacy Folly wave/current station](https://www.seoe.sc.edu/gvoulgar/Folly_data.html) identifies a nearshore station at **32°39.009′ N, 79°56.217′ W**, approximately 1,500 feet beyond the old pier in roughly 4 m of water. The page advertises directional waves/currents and DODS access. The linked historical data service did not resolve successfully in this review. Coverage, sampling cadence, data license and recoverable raw records remain unverified. This is a promising archive/contact lead, not a working live feed.

[Xin Jin's 2001 Clemson thesis catalog](https://open.clemson.edu/arv_theses/4281/), “Nearshore Wave and Current Measurements and Prediction: Folly Beach, South Carolina,” is another relevant local study. The repository limits archived-thesis access to eligible university access or interlibrary loan; full text was not reviewed.

### 5. WebCOOS: useful imagery leads, with actual availability limits

| Public camera page | What was verified on 21 October 2026 | What remains unverified |
| --- | --- | --- |
| [Folly pier south](https://www.webcoos.org/cameras/follypiersouthcam/) | Explicitly archive-only; Video Gallery; inventory reports 6,102 files. Calendar has enabled days from 3 March 2018 through 4 January 2021, with gaps. | Media pane returned “Failed to fetch.” No playback, bulk download, frame calibration or regular sampling cadence was validated. Calendar dates alone do not establish a complete daily time series. |
| [Folly 6th Avenue](https://webcoos.org/cameras/folly6thavenue/) | Image Gallery for beach-use monitoring; inventory reports 4,145 files. Visible coverage spans August 2022 to 19 August 2026. | Media pane returned “Failed to fetch.” This was not verified as current live video or as a usable sequence of breaking waves. |

[SECOORA's September 2022 program report](https://secoora.org/wp-content/uploads/2024/03/WebCOOS_PR_2022-09.pdf) describes the 6th Avenue installation as a snapshot camera. Do not infer continuous video from the WebCOOS platform's general capabilities.

The [published API access documentation](https://stage-webcoos.srv.axds.co/docs/doc/access/) describes token-authenticated assets, service inventories and time-bounded elements/download URLs. The [official Python client](https://github.com/WebCOOS/py-webcoos-client) provides the corresponding workflow. Production documentation is linked from the camera pages; the readable documentation copy checked here is on the staging documentation host, so confirm the current contract before implementation. No API token was obtained or tested.

[Usage guidelines](https://webcoos.org/usage-guidelines) request reasonable download volumes, contact before large downloads of imagery older than 90 days, and attribution. They are not a blanket public-domain license for imagery. The Python client's software license does not determine the rights to camera media. The next step is to establish archive access and permitted reuse, then inspect representative clips before investing in labels or an embed.

### Historical DEM candidate

[NOAA 2016–2017 South Carolina topobathymetric DEM metadata](https://coast.noaa.gov/htdata/raster2/elevation/NGS_SC_Topobathy_DEM_2016_8585/sc2016_ngs_topobathy_dem_m8585_met_forHumans.html) describes collection from 2 October 2016 to 1 March 2017 and publication in 2018. The metadata states no access constraints and requests NOAA credit. Exact tile overlap and valid underwater coverage at the selected surf spot were not checked; no tiles were downloaded. Use it only after checking its actual data footprint, acquisition dates and vertical datum. It is historical background, not current sandbar evidence.

## Implementation and evaluation references

Keep operational instructions in their canonical documents:

| Area | Current reference | Scope |
| --- | --- | --- |
| Production and collection | [Deployment guide](../DEPLOY-CLOUDFLARE.md) | Endpoints, source freshness, private archives and scheduled heartbeat verification |
| Public score | [Folly Index formula](../web/formula.html) and [nearshore-to-surf study](NEARSHORE-TO-SURF.md) | V3 heuristic and its unvalidated mapping to rideable waves; missing inputs never receive favorable defaults |
| Survey import | [Survey workflow](surveys/README.md) and [source metadata](bathymetry-sources.json) | Reproducible commands, checksums, dated measurements and datum limits |
| Independent beach observations | [Observation workflow](observations/README.md) | Fixed protocol, board/skill cohorts, event holdouts and physical height definitions |
| Incoming-wave spectra | [Wave study](waves/README.md) | Raw NOAA model spectra and prospective comparisons; no additional production multiplier |
| Camera sampling | [Browser sampling](../camera-service/BROWSER-SAMPLING.md) | Bounded private pilot; source time and quantitative surf measurements remain unverified |

### Coastal station interpretation

The deployed coastal feed uses NOAA CO-OPS **8665530 Charleston** (NDBC alias **CHTS1**), with water level in **MLLW**. The [official station page](https://www.ndbc.noaa.gov/station_page.php?station=chts1) identifies an anemometer 16.374 m above site elevation. Label these observations Charleston station wind, not Folly beach wind or interchangeable 10 m model wind. Charleston water level is not oceanfront water level or a NAVD88 correction for BERM profiles. The water-level datum epoch is unknown because the observation API does not return it. API references: [CO-OPS data API](https://api.tidesandcurrents.noaa.gov/api/prod/) and [response help](https://api.tidesandcurrents.noaa.gov/api/prod/responseHelp.html).

## Remaining evidence and access limits

1. **Usable, permitted camera sequences:** WebCOOS asset authentication and actual archive playback/download remain unverified. Listed calendars and inventories are not successful access. The currently linked commercial camera pages are not a blanket licence to embed or redistribute imagery. Obtain access/permission and inspect representative clips before claiming camera-derived observations.
2. **Legacy in-water instruments:** Recover the University of South Carolina station records and verify cadence, coverage and licence; the old service remains a lead, not a live input. Abstracts/catalog records do not replace unavailable thesis/full-text data.
3. **Current local geometry and common datums:** Imported annual transects are dated and spatially sparse. Confirm unverified vertical datums, verify modern topobathymetric coverage, and establish valid transformations before joining elevations and water levels. Do not fill missing local sandbar geometry with an unexplained interpolation.
4. **Independent local outcomes:** Collect actual, blinded, timestamped Folly beach-quality observations under a fixed protocol. Height, shape, ride opportunities, safety and surfer/board assumptions are distinct variables. Surfer counts and beach attendance are not quality labels. No real local-quality label dataset or trained correction exists in this project yet.
5. **Prospective evaluation before model changes:** Accumulate forecasts before their valid times, retain whole-event holdouts, inspect observer agreement, and compare any future fitted method against the current baseline with sample sizes and nourishment/lead-time strata. New coefficients must not be presented as validated merely because more data feeds are available.

The implemented result is a provenance-preserving collection and evaluation pipeline. A trained Folly-specific correction remains contingent on independently measured local outcomes and honest held-out evaluation.
