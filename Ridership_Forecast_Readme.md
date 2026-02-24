# Ridership Forecasting Tool

A corridor-level ridership forecasting tool built into the Micro Analysis Tool. It estimates transit ridership potential for a proposed corridor by combining demographic demand analysis with service design parameters, producing defensible ridership ranges rather than single-point predictions.

This tool does not replace a full regional travel demand model. It is a decision-support tool designed to compare service types and inform corridor-level planning.

---

## What This Tool Does

The Ridership Forecasting module answers the question: **"If we run transit service along this corridor, how many riders might we expect?"**

It works in four steps:

1. **Demand Analysis** -- Measures how much latent transit demand exists along the corridor based on who lives and works there
2. **Calibration** (optional) -- Adjusts the demand estimate using observed ridership from real routes, so the forecast reflects actual local performance
3. **Elasticity** -- Estimates how ridership responds to changes in service frequency and quality (e.g., switching from local bus to BRT)
4. **Scenario Comparison** -- Compares multiple service configurations side-by-side, showing ridership, operating cost, and productivity for each

Each step builds on the previous one. You can run Demand alone for a quick assessment, or work through all four tabs for a full corridor analysis.

---

## How to Access It

1. Open the Micro Analysis Tool in your browser
2. Draw a route (or place stations/lines) on the map to define your corridor
3. In the left sidebar, find the **Analysis** panel
4. Click the **Ridership Forecasting** button to open the module popup

The popup has four tabs across the top: **Demand**, **Calibrate**, **Elasticity**, and **Scenarios**.

---

## The Demand Score: Corridor Demand Index (CDI)

At the heart of the model is the **Corridor Demand Index (CDI)**, a single number from 1 to 5 that summarizes how transit-supportive the demographics are along your corridor.

### How CDI is calculated

The CDI builds on the Transit Propensity Index (TPI), which scores every census geography (block group or tract) in the corridor on nine factors:

| Factor | What it measures | Why it matters for transit |
|---|---|---|
| Population Density | People per square mile | More people = more potential riders |
| Employment Density | Jobs per square mile (from LODES data) | Commute destinations generate ridership |
| Zero-Vehicle Households | % of households with no car | Transit-dependent population |
| Low-Income (Poverty) | % of people below poverty level | Higher transit reliance |
| Seniors (65+) | % of population age 65 and over | Often transit-dependent |
| Disability | % of population with a disability | Often transit-dependent |
| People of Color | % of population who are people of color | Equity consideration; historically underserved |
| Youth (under 18) | % of population under 18 | Cannot drive; transit-dependent |
| Limited English Proficiency | % who speak English less than very well | Often transit-dependent |

For each factor, every geography in the corridor is ranked against the other geographies in the same corridor using quintiles (fifths). A geography in the top 20% for population density gets a 5; one in the bottom 20% gets a 1. This means scores are always relative to your specific study area, not a national benchmark.

The nine factor scores are combined into a weighted average (the TPI composite score), and then the CDI is calculated as a population-weighted average of all the TPI scores across the corridor. This means areas with more people count more toward the overall CDI.

### How to interpret CDI

| CDI Score | Classification | What it means |
|---|---|---|
| 4.0 -- 5.0 | **High** | Strong latent demand. Demographics strongly support transit investment. |
| 3.0 -- 3.9 | **Medium** | Moderate demand. Transit can work here with good service design. |
| 2.0 -- 2.9 | **Low-Medium** | Below-average demand. Service may need strong frequency or speed advantages to attract riders. |
| Below 2.0 | **Low** | Weak demand signal. Consider whether other factors (major destinations, development plans) justify service. |

A CDI of 3.5 does not mean "3.5 riders." It is an index that feeds into the ridership estimate when combined with calibration and service parameters.

---

## Tab 1: Demand

This tab runs the core demand analysis and produces the CDI score.

### Settings (left side)

- **Geography Level** -- Choose between Census Tracts (faster, less detailed) or Block Groups (slower, more granular). Block Groups are the default and recommended for corridor-level work.

- **ACS Year** -- Which year of American Community Survey data to use. Default is 2024 (the most recent available).

- **Segment Length** -- If set above zero, the route is divided into equal-length segments (e.g., every half mile) and each segment gets its own CDI score. This shows where demand is strongest along the corridor. Set to 0 to skip segmentation.

- **Apportion by Area** -- When checked, geographies that only partially overlap the corridor buffer are scaled proportionally. This is more accurate for edge cases but slightly slower.

### Analyze Demand (button)

Click this to run the analysis. The tool will:
1. Query census geographies that overlap your corridor buffer
2. Fetch demographic data from the Census Bureau API
3. Score each geography on the nine TPI factors
4. Compute the corridor-wide CDI and segment-level CDI (if segmentation is on)
5. Render a color-coded map (choropleth) on the map view

### Results (right side)

- **CDI Score** -- The corridor-wide demand index (1--5 scale). Click the information icon next to the label for a brief explanation.

- **Classification Badge** -- Color-coded label: High (green), Medium (yellow), Low-Medium (orange), or Low (red).

- **Statistics** -- Number of geographies analyzed, how many were successfully scored, total route length in miles, and number of segments.

- **Segment Breakdown** -- If segmentation is enabled, shows each segment's CDI score and classification. Useful for identifying where along the corridor demand is strongest or weakest.

- **Factor Scores** -- The average score (1--5) for each of the nine TPI factors, plus the effective weight used. This shows which factors are driving the overall score.

### Exports

- **GeoJSON** -- Downloads a geographic file with every scored geography, including raw values, quintile scores, and CDI classification. Can be opened in GIS software or mapping tools.

- **CSV** -- Downloads the same data as a spreadsheet-compatible table.

### Next Steps

After the analysis completes, a message appears suggesting you either continue to the **Elasticity** tab (to estimate ridership under different service types) or go to the **Calibrate** tab (to ground the model in observed data first).

---

## Tab 2: Calibrate

This tab is optional but recommended. It lets you adjust the model's output using observed ridership data from real transit routes, so forecasts reflect actual local performance rather than relying solely on demographics.

### When to use calibration

- If you have route-level ridership data from the transit agency you are analyzing (e.g., daily boardings by route)
- If you have comparable data from a peer system (e.g., UTA route-level data for a Mountain West comparison)
- If you have system-level NTD data and want to establish a baseline productivity ratio

### How to calibrate

1. **Upload CSV** -- Click the upload button and select a CSV file containing observed ridership data. Expected columns include route name, daily ridership (or boardings per hour), peak headway, and service type. The tool will attempt to auto-detect which columns map to which fields.

2. **Column Mapping** -- After upload, verify or correct the column assignments using the dropdown menus. The tool guesses based on common column names but you should confirm.

3. **Choose a Method**:
   - **Ratio-based (recommended)** -- Divides each route's observed ridership by its computed demand index and averages the results. Simple, robust, and works well with small datasets (5--15 routes). Produces a single calibration factor.
   - **Simple regression** -- Fits a line through the data (observed ridership vs. demand index). Better if you have more data (10+ routes) and want to account for scatter. Produces an intercept and slope.

4. **Review Results** -- The tool shows:
   - **Calibration Factor** -- The multiplier that will be applied to CDI in all future forecasts
   - **R-squared** -- How well the calibration fits the observed data (0 to 1; higher is better). Only shown for regression.
   - **Sample Size** -- How many routes were used

5. **Warnings** -- If the sample size is very small (fewer than 5 routes), a warning appears. The calibration still works but should be interpreted with caution.

### Import / Export Coefficients

- **Export Coefficients** -- Saves the calibration factor, method, and fit statistics as a JSON file. Useful for sharing calibration settings between sessions or with colleagues.

- **Import Coefficients** -- Loads a previously exported calibration file, restoring the factor without needing to re-upload and re-process the observed data.

---

## Tab 3: Elasticity

This tab estimates how ridership changes when you improve service frequency or upgrade the service type. It converts the CDI demand score into a ridership multiplier using transit industry elasticity values.

### Service Parameters (left side)

- **Service Type** -- Select the type of service you are proposing:

  | Service Type | Description |
  |---|---|
  | **Local Bus** | Standard fixed-route bus service. This is the baseline -- all premiums are zero. |
  | **Enhanced Bus** | Improved bus service with features like better stops, limited branding, or queue jumps. Moderate premiums for frequency, speed, and mode quality. |
  | **Limited-Stop Express** | Skips intermediate stops for faster travel on longer trips. Premiums focused on speed improvement. |
  | **BRT-Style** | Bus Rapid Transit characteristics: dedicated lanes, level boarding, real-time info, branded stations. Highest premiums across all categories. |

- **Baseline Headway** -- The current or comparison service frequency in minutes (e.g., 30-minute headways for existing local bus).

- **Proposed Headway** -- The frequency you are proposing (e.g., 15-minute headways for a new enhanced bus).

- **Frequency Elasticity** -- A slider and input box (range 0.1 to 1.0, default 0.5). This value controls how strongly ridership responds to frequency changes. The typical range from TCRP (Transit Cooperative Research Program) is 0.3 to 0.6. A value of 0.5 means that doubling frequency increases ridership by about 41%.

### Service Type Premiums (right side)

When you select a service type, the tool shows three premium categories:

| Premium | What it represents | Example (BRT-Style) |
|---|---|---|
| **Frequency** | Ridership boost from improved frequency reliability and consistency | +15% to +35% |
| **Speed** | Ridership boost from faster travel times (dedicated lanes, signal priority, fewer stops) | +15% to +35% |
| **Mode** | Ridership boost from the quality and attractiveness of the service itself (branding, stations, comfort) | +25% to +50% |

Each premium has a low, middle, and high value. These are applied multiplicatively to produce three ridership estimates.

### Ridership Multiplier (right side)

Once you have run a demand analysis (Tab 1), this section shows three estimates:

- **Conservative** -- Uses the low end of all premiums. Represents a cautious forecast.
- **Moderate** -- Uses the middle of all premiums. The most likely outcome.
- **Optimistic** -- Uses the high end of all premiums. Represents a best-case scenario.

The estimates are shown as index values. They become actual ridership numbers when combined with calibration data and route-specific parameters in the Scenarios tab.

Two additional statistics are shown:
- **Frequency Effect** -- The multiplier from the headway change alone (e.g., 1.41x for going from 30 to 15 minutes at 0.5 elasticity)
- **Base CDI** -- The corridor demand score being used as the starting point

---

## Tab 4: Scenarios

This tab lets you define up to four different service configurations and compare them side-by-side on ridership, operating cost, and productivity metrics.

### Scenario Sub-Tabs

Four scenario slots are available: **A**, **B**, **C**, and **D**. Click a tab to switch between them. Your inputs are saved automatically when you switch.

### Scenario Inputs

For each scenario, you define:

| Input | Description | Default |
|---|---|---|
| **Scenario Name** | A label for this scenario (e.g., "Enhanced Bus - 15 min") | "Scenario A" |
| **Service Type** | Local Bus, Enhanced Bus, Limited-Stop Express, or BRT-Style | Local Bus |
| **Peak Headway** | Service frequency in minutes during peak hours | 30 min |
| **Service Span** | Hours of service per day (e.g., 6 AM to 8 PM = 14 hours) | 14 hrs |
| **Average Speed** | Average operating speed including stops, in mph | 15 mph |
| **Cost per Revenue Hour** | Operating cost including driver, fuel, maintenance, and overhead | $150 |
| **Service Days per Year** | How many days per year the service operates | 260 (weekday only) |

Service days presets: 260 (weekday only), 302 (weekday + Saturday), 312 (daily except holidays), 365 (daily).

### Build Scenarios (button)

Click this to compute all metrics for all four scenarios at once. The tool calculates:

| Metric | What it means |
|---|---|
| **Vehicles Needed** | Minimum number of buses to maintain the headway, based on route length and speed |
| **Revenue Hours / Day** | Total hours of in-service vehicle operation per day |
| **Annual Revenue Hours** | Revenue hours per day multiplied by service days per year |
| **Annual Operating Cost** | Annual revenue hours multiplied by cost per revenue hour |
| **Daily Ridership (Low / Mid / High)** | Estimated daily boardings based on CDI, elasticity premiums, and calibration factor (if available). Three estimates reflecting conservative, moderate, and optimistic assumptions. |
| **Annual Ridership (Mid)** | Moderate daily estimate multiplied by service days per year |
| **Boardings per Revenue Hour** | Annual ridership divided by annual revenue hours. A key productivity metric -- typical for bus is 10-30 depending on context. |
| **Cost per Boarding** | Annual operating cost divided by annual ridership. Lower is better. Typical range is $3-$15 for productive bus routes. |

### Comparison Table

After building scenarios, a table appears showing all four scenarios as columns with all metrics as rows. The moderate (mid) ridership rows are highlighted to draw attention to the most likely outcome.

### Exports

- **Export CSV** -- Downloads the comparison table as a spreadsheet-compatible file. One row per scenario with all metrics.

- **Export JSON** -- Downloads the full scenario data in JSON format, including all input parameters and computed results. Useful for importing into other tools or archiving the analysis.

---

## How the Math Works

This section explains the key calculations in plain terms for anyone who wants to understand the model logic.

### Frequency Effect

When you improve frequency (reduce headway), ridership increases -- but not proportionally. The relationship follows a power curve:

> **Frequency effect = (new frequency / old frequency) raised to the power of the elasticity value**

Frequency is calculated as 60 divided by the headway in minutes (e.g., 15-minute headway = 4 trips per hour).

**Example**: Going from 30-minute headways (2 trips/hour) to 15-minute headways (4 trips/hour) with an elasticity of 0.5:
> Effect = (4 / 2) ^ 0.5 = 2 ^ 0.5 = 1.41

This means a 41% ridership increase from the frequency improvement alone.

### Combined Ridership Multiplier

The total ridership multiplier combines the frequency effect with the service type premiums:

> **Multiplier = frequency effect x (1 + frequency premium) x (1 + speed premium) x (1 + mode premium)**

Each premium comes from the selected service type and has a low, mid, and high value, producing three multiplier estimates.

### Ridership Estimate

> **Estimated ridership = CDI score x multiplier x calibration factor**

If no calibration has been done, the calibration factor defaults to 1 (no adjustment). The CDI score here is the corridor-wide population-weighted average from Tab 1.

### Operating Metrics

> **Vehicles needed = ceiling of (2 x route length / average speed) / (headway / 60)**

This ensures enough buses are available to maintain the headway given the round-trip time.

> **Revenue hours per day = vehicles needed x service span**

> **Annual operating cost = revenue hours per day x service days x cost per revenue hour**

> **Boardings per revenue hour = annual ridership / annual revenue hours**

> **Cost per boarding = annual operating cost / annual ridership**

---

## Typical Workflows

### Quick Corridor Assessment

1. Draw a route on the map
2. Open Ridership Forecasting
3. On the **Demand** tab, click **Analyze Demand**
4. Review the CDI score and segment breakdown
5. Export GeoJSON to visualize in GIS if needed

Time: 2-5 minutes

### Compare Service Types

1. Complete the quick assessment above
2. Go to the **Elasticity** tab
3. Select different service types (Enhanced Bus, BRT, etc.)
4. Compare the Conservative / Moderate / Optimistic ranges
5. Adjust the frequency elasticity slider to test sensitivity

Time: 5-10 minutes

### Full Scenario Analysis

1. Draw the corridor route on the map
2. Upload LODES employment data (optional, from the sidebar)
3. Run **Analyze Demand** on the Demand tab
4. Go to the **Calibrate** tab, upload observed ridership data, run calibration
5. Go to the **Scenarios** tab
6. Define Scenario A: current service (Local Bus, 30 min, $150/hr)
7. Define Scenario B: improved service (Enhanced Bus, 20 min, $150/hr)
8. Define Scenario C: premium service (BRT-Style, 10 min, $180/hr)
9. Click **Build Scenarios**
10. Review the comparison table
11. Export CSV for reports or presentations

Time: 15-30 minutes (depending on data availability)

### Calibrate with Peer System Data

1. Obtain route-level ridership data from a peer agency (e.g., UTA monthly ridership reports)
2. For each peer route, run the demand analysis in this tool to get its CDI
3. Combine into a CSV: route name, observed daily ridership, peak headway, service type
4. Upload to the **Calibrate** tab
5. The calibration factor now reflects real-world performance from a comparable system
6. Continue with Elasticity and Scenarios -- all forecasts now use the calibrated factor

---

## What This Tool Is and Is Not

**It is:**
- A corridor-level decision-support tool for comparing service types
- Grounded in census demographics and transit demand research
- Designed to produce ranges (conservative, moderate, optimistic) rather than precise predictions
- Transparent in its assumptions -- every parameter is visible and adjustable
- Locally calibratable using observed ridership data

**It is not:**
- A full four-step travel demand model
- A substitute for MPO or regional modeling
- Predicting exact future-year ridership
- Accounting for induced demand, land use changes, or network effects

The forecasts should be used alongside professional judgment, local knowledge, and other planning tools.

---

## Export File Formats

| Export | Tab | Format | Contents |
|---|---|---|---|
| Demand GeoJSON | Demand | `.geojson` | Every scored geography with CDI score, classification, raw factor values, and quintile scores. Openable in GIS. |
| Demand CSV | Demand | `.csv` | Same data in tabular format. Openable in Excel. |
| Calibration Coefficients | Calibrate | `.json` | Calibration factor, method, R-squared, and sample size. Importable in future sessions. |
| Scenario Comparison CSV | Scenarios | `.csv` | One row per scenario with all operating and ridership metrics. Openable in Excel. |
| Scenario Comparison JSON | Scenarios | `.json` | Full scenario parameters and results. Useful for archiving or feeding into other tools. |

---

## Glossary

| Term | Definition |
|---|---|
| **ACS** | American Community Survey. Annual demographic survey by the US Census Bureau. The tool uses the 5-year estimates. |
| **Block Group** | A Census geography containing roughly 600-3,000 people. More granular than tracts. |
| **Boardings per Revenue Hour** | Number of passenger boardings divided by hours of in-service vehicle operation. A standard transit productivity metric. |
| **BRT** | Bus Rapid Transit. Premium bus service with dedicated lanes, branded stations, and frequent service. |
| **CDI** | Corridor Demand Index. The model's composite demand score (1-5 scale). |
| **Calibration Factor** | A multiplier derived from observed ridership data that scales the model's output to match real-world performance. |
| **Census Tract** | A Census geography containing roughly 1,200-8,000 people. Larger than block groups. |
| **Cost per Boarding** | Annual operating cost divided by annual ridership. Measures cost-effectiveness. |
| **Elasticity** | How sensitive ridership is to changes in a variable (like frequency). An elasticity of 0.5 means a 10% increase in frequency yields about a 5% increase in ridership. |
| **Headway** | Time between consecutive buses at a stop, in minutes. Lower headway = more frequent service. |
| **LODES** | LEHD Origin-Destination Employment Statistics. Block-level employment data from the Census Bureau. |
| **NTD** | National Transit Database. Federal reporting system with system-level ridership and financial data for every US transit agency. |
| **OLS Regression** | Ordinary Least Squares. A statistical method that fits a best-fit line through data points. |
| **Quintile** | One-fifth of a ranked dataset. The top quintile (5) is the highest 20%; the bottom quintile (1) is the lowest 20%. |
| **Revenue Hour** | One hour of in-service vehicle operation (bus on the road, doors open to passengers). |
| **Service Span** | Hours per day that a route operates (e.g., 6 AM to 8 PM = 14-hour span). |
| **TCRP** | Transit Cooperative Research Program. A federally funded research program that publishes guidance on transit planning topics, including elasticity values. |
| **TIGERweb** | The Census Bureau's geographic boundary service used to retrieve tract and block group shapes. |
| **TPI** | Transit Propensity Index. The 9-factor scoring model that feeds into the CDI. |
