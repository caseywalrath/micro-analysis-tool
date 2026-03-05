# Offline Crosswalk Guide: TAZ Projections → Census Tract Growth Factors

**Purpose:** Convert the PPACG MPO's TAZ-level population projections into census tract growth factors that the analysis tool can use. This is a one-time process per metro area. The result is a small CSV file you upload into the tool.

**License required:** ArcGIS Pro Basic (all tools used are available at Basic)

**Time estimate:** 45–60 minutes the first time; ~15 minutes for subsequent project areas once you have the base data layers set up.

---

## What You're Building

The tool works with census tract geographies. The MPO data uses TAZ geographies. These don't line up. The crosswalk calculates, for each census tract: "what is the population-weighted average growth rate across all the TAZs that overlap this tract?"

The output looks like this:

```
GEOID,gf_2030,gf_2040,gf_2050
08041960100,1.08,1.22,1.41
08041960200,1.02,1.05,1.09
...
```

`gf_2050 = 1.41` means the model projects 41% population growth in that tract by 2050. The tool multiplies your current ACS census population by this factor when running a future-year analysis.

---

## Part 1: Gather Your Data Layers

### Step 1A — Export the TAZ Layer from ArcGIS Online

The MPO TAZ service requires login, so you'll export it manually rather than querying it directly.

1. Sign in to ArcGIS Online at [arcgis.com](https://www.arcgis.com)
2. In the Search bar, search for: `PPACG TAZ Forecasted Changes`
3. Open the item page for **PPACG TAZ Forecasted Changes 2020 to 2050**
4. Click **Open in Map Viewer** (or click the three-dot menu and choose **Export → Export to GeoJSON** or **Export to Shapefile**)
   - GeoJSON is fine; shapefile also works
   - If prompted for an extent, choose the full layer
5. Download the exported file to your computer
6. Note the folder location — you'll add it to ArcGIS Pro in Step 2

> **Alternative:** If you have the layer already loaded in a web map, you can right-click the layer in Map Viewer and choose **Save As Layer File** or export directly from there.

---

### Step 1B — Download Census Tract Boundaries

You need census tract polygons for the same state. The fastest source is the Census TIGER/Line shapefiles.

1. Go to: [https://www.census.gov/cgi-bin/geo/shapefiles/index.php](https://www.census.gov/cgi-bin/geo/shapefiles/index.php)
2. Select **Year: 2022** (or the year closest to your ACS data vintage — use the same year your tool is configured to query)
3. Under **Layer type**, select **Census Tracts**
4. Select **State: Colorado**
5. Click **Submit**, then download the `.zip` file
6. Unzip it to a known folder (e.g., `C:\GIS_Data\Census\`)

The file will be named something like `tl_2022_08_tract.shp` (08 = Colorado FIPS code).

---

## Part 2: Set Up Your ArcGIS Pro Project

### Step 2A — Create a New Project

1. Open ArcGIS Pro
2. Click **New** → **Map** → give it a name like `TAZ_Crosswalk` → click **OK**
3. A new map opens with a basemap

### Step 2B — Add Both Layers

**Add the census tracts:**
1. In the **Catalog** pane (right side), click **Add Data** (folder icon) or use the **Map** tab → **Add Data** button
2. Browse to where you saved the census tracts shapefile
3. Select `tl_2022_08_tract.shp` and click **OK**

**Add the TAZ layer:**
1. Click **Add Data** again
2. Browse to the GeoJSON or shapefile you exported from ArcGIS Online
3. Select it and click **OK**

Both layers should now appear in your **Contents** pane on the left and be visible on the map. Zoom to Colorado to confirm both layers look right — you should see the TAZ areas overlapping with census tracts across the metro area.

### Step 2C — Check the Field Names

Before proceeding, verify the actual field names in the TAZ attribute table (field names in the database may differ from the display aliases):

1. Right-click the TAZ layer in the **Contents** pane → **Attribute Table**
2. Look for fields containing population data. They might be named:
   - `POP_2020`, `POP_2030`, `POP_2040`, `POP_2050` — or
   - `Pop2020`, `Pop2030`, etc. — or
   - `Population_2020`, etc.
3. Write down the exact field names for Population 2020, 2030, 2040, and 2050. You'll need these in later steps.
4. Also note the TAZ ID field name (likely `TAZ` or `TAZ_ID`)

> **If the fields have commas in their values** (like "1,010"), the data was exported with number formatting. You may need to clean this — see the note at the end of Part 3.

---

## Part 3: Run the Spatial Overlay (Intersect)

The Intersect tool cuts both polygon layers against each other, creating a new layer where every polygon represents the overlap between one TAZ and one census tract. This is how we calculate how much of each tract comes from each TAZ.

### Step 3A — Open the Intersect Tool

1. Click the **Analysis** tab in the ribbon
2. Click **Tools** to open the Geoprocessing pane
3. In the search box, type `Intersect`
4. Click **Intersect (Analysis Tools)**

### Step 3B — Configure the Tool

- **Input Features:** Add both layers:
  - Click the dropdown and add your **Census Tracts** layer
  - Click the dropdown again and add your **TAZ** layer
- **Output Feature Class:** Give it a name like `TAZ_Tract_Intersect` and save it in your project geodatabase (the default location is fine)
- **Join Attributes:** Leave as `ALL`
- **Output Type:** Leave as `INPUT` (polygons)

Click **Run**. This may take 1–3 minutes depending on the number of TAZs and tracts.

### Step 3C — Verify the Output

1. The result layer (`TAZ_Tract_Intersect`) appears in the Contents pane
2. Open its attribute table (right-click → Attribute Table)
3. You should see columns from both the census tracts AND the TAZ layer combined into one table. Each row is one intersection polygon.
4. Confirm columns exist for: census tract GEOID, TAZ population fields, and the TAZ ID field

> **Expected row count:** There will be many more rows than either source layer had individually — that's correct. One TAZ spanning 3 tracts generates 3 rows.

---

## Part 4: Calculate Areas and Growth Factors

Now you'll add calculated fields to the intersection layer. All of this is done in the attribute table using **Add Field** and **Field Calculator**.

### Step 4A — Calculate Intersection Area

1. In the attribute table toolbar, click **Add** (the plus icon) to add a new field
   - **Name:** `area_sqm`
   - **Data Type:** `Double`
   - Click **OK**
2. Right-click the `area_sqm` column header → **Calculate Geometry**
   - **Property:** `Area`
   - **Area Unit:** `Square Meters`
   - Click **OK**

Each row now has the area of that intersection piece in square meters.

### Step 4B — Calculate TAZ Growth Factors

You need one growth factor column per projection year. These are ratios: projected population ÷ 2020 population.

**For 2030:**
1. Add a new field: **Name:** `gf_2030`, **Data Type:** `Double`
2. Right-click `gf_2030` → **Calculate Field**
3. In the expression box, type (substituting your actual field names from Step 2C):
   ```python
   !POP_2030! / !POP_2020! if !POP_2020! and !POP_2020! > 0 else 1.0
   ```
4. Click **OK**

**Repeat for 2040:**
1. Add field `gf_2040` (Double)
2. Calculate Field: `!POP_2040! / !POP_2020! if !POP_2020! and !POP_2020! > 0 else 1.0`

**Repeat for 2050:**
1. Add field `gf_2050` (Double)
2. Calculate Field: `!POP_2050! / !POP_2020! if !POP_2020! and !POP_2020! > 0 else 1.0`

> **What the `if` condition does:** TAZs with zero 2020 population would cause a division-by-zero error. The condition sets growth factor to 1.0 (no change) for those cases. This is correct behavior — an empty TAZ in 2020 that has projected population in 2050 is likely a model artifact.

### Step 4C — Calculate Weighted Contributions

For each intersection polygon, you want: `area × growth_factor`. These are the numerator values you'll sum up per tract.

**For 2030:**
1. Add field `w_gf_2030` (Double)
2. Calculate Field: `!area_sqm! * !gf_2030!`

**Repeat for 2040 and 2050:**
- `w_gf_2040` = `!area_sqm! * !gf_2040!`
- `w_gf_2050` = `!area_sqm! * !gf_2050!`

---

## Part 5: Summarize by Census Tract

Now you aggregate all the intersection pieces up to the tract level by summing the weighted contributions.

### Step 5A — Run Summary Statistics

1. In the Geoprocessing pane, search for `Summary Statistics`
2. Click **Summary Statistics (Analysis Tools)**
3. Configure:
   - **Input Table:** `TAZ_Tract_Intersect`
   - **Output Table:** Name it `Tract_GrowthFactors` (this will be a table, not a shapefile)
   - **Statistics Fields:** Add each of the following:
     | Field | Statistic Type |
     |-------|---------------|
     | `area_sqm` | SUM |
     | `w_gf_2030` | SUM |
     | `w_gf_2040` | SUM |
     | `w_gf_2050` | SUM |
   - **Case Field:** Set this to your census tract **GEOID** field (it might be called `GEOID`, `GEOID_1`, or similar — look for the 11-character tract identifier)
4. Click **Run**

The result is a table with one row per census tract and summed values for area and weighted growth factor contributions.

### Step 5B — Calculate Final Growth Factors

Open the `Tract_GrowthFactors` table. It will have columns like `SUM_area_sqm`, `SUM_w_gf_2030`, etc.

Now divide to get the final area-weighted growth factors:

**For 2030:**
1. Add field `gf_2030` (Double) to this table
2. Calculate Field:
   ```python
   !SUM_w_gf_2030! / !SUM_area_sqm! if !SUM_area_sqm! and !SUM_area_sqm! > 0 else 1.0
   ```

**Repeat for 2040 and 2050:**
- `gf_2040` = `!SUM_w_gf_2040! / !SUM_area_sqm! if !SUM_area_sqm! and !SUM_area_sqm! > 0 else 1.0`
- `gf_2050` = `!SUM_w_gf_2050! / !SUM_area_sqm! if !SUM_area_sqm! and !SUM_area_sqm! > 0 else 1.0`

### Step 5C — Rename the GEOID Column

The GEOID column in the Summary Statistics output may have been renamed (e.g., to `GEOID_1` or `CASE_GEOID`). The tool expects a column called `GEOID`.

1. In the table, right-click the GEOID column header → **Fields** (opens the Fields view)
2. Find the GEOID field and change its **Field Name** to `GEOID`
3. Save and close the Fields view

---

## Part 6: Export to CSV

### Step 6A — Remove Unnecessary Columns (Optional but Recommended)

The summary table has many intermediate columns (`SUM_area_sqm`, `SUM_w_gf_2030`, etc.) that you don't need in the final CSV. You can hide them:

1. In the table, right-click any column header → **Fields**
2. Uncheck the visibility boxes for all columns except: `GEOID`, `gf_2030`, `gf_2040`, `gf_2050`
3. Save

### Step 6B — Export as CSV

1. Right-click the `Tract_GrowthFactors` table in the **Contents** pane
2. Choose **Data → Export Table**
3. Configure:
   - **Output Table:** Browse to a folder and name the file `ppacg_growth_factors.csv`
   - Make sure the format is `.csv` (Text File)
4. Click **OK**

### Step 6C — Verify the Output

Open the CSV in Excel or a text editor. It should look like:

```
GEOID,gf_2030,gf_2040,gf_2050
08001000100,1.00,1.00,1.00
08001000201,1.03,1.08,1.14
08041000100,1.12,1.35,1.88
...
```

**Things to check:**
- The GEOID column contains 11-character strings (not numbers — Excel sometimes strips leading zeros)
- Growth factor values are reasonable. Most tracts should be between 0.8 and 3.0. Very large values (>5) may indicate a data issue in the TAZ layer.
- The file has no header other than the column names (no title row)

> **If Excel stripped leading zeros from GEOIDs:** Open the CSV in a text editor (Notepad, VS Code) and check whether GEOIDs like `08001000100` appear correctly. If they show as `8001000100` (10 digits instead of 11), you'll need to reformat. In Excel: select the GEOID column → Format Cells → Text → re-enter a value to trigger re-read, or simply use the text editor to confirm the raw file is correct (ArcGIS usually preserves them as strings).

---

## Part 7: Upload to the Tool

1. In the web analysis tool, open the **Population Projections** panel in the left sidebar (it starts collapsed — click the header to expand)
2. Click **Upload CSV**
3. Select your `ppacg_growth_factors.csv` file
4. The panel will show: "Loaded: ppacg_growth_factors.csv — [N] tracts"
5. Use the **Projection year** dropdown to select `2030`, `2040`, or `2050`
6. Run the Transit Propensity Index or Ridership Forecasting analysis as usual — population will now reflect the selected projection year

To return to current-year analysis, set the dropdown back to **Current (ACS)** or click **Clear**.

---

## Troubleshooting

**"The Intersect tool ran but my output has very few rows"**
Both layers must use the same coordinate system (projection). Check: right-click each layer → Properties → Source tab → Spatial Reference. If they differ, reproject one to match the other using **Project (Data Management)** before running Intersect.

**"My growth factors are all 1.0"**
This usually means the GEOID column from the census tracts didn't match the CASE field in Summary Statistics. Open the intersection layer attribute table and confirm you can see the tract GEOID values. Also confirm the Summary Statistics case field points to the right column.

**"Some growth factor values are very high (10x, 50x)"**
Check the TAZ population fields for that record. If `POP_2020 = 0` and `POP_2050 = 100`, the growth factor is technically infinite — the formula returns 1.0 for zero-baseline TAZs, but if there are data entry issues in the TAZ layer, you may see outliers. You can cap values: change the Calculate Field expression to `min(10.0, !SUM_w_gf_2050! / !SUM_area_sqm!)` as a safeguard.

**"I have tracts with no TAZ coverage"**
This can happen near the metro boundary. Those tracts will have `SUM_area_sqm = 0` in the Summary Statistics output and the `if > 0 else 1.0` condition handles them by assigning a growth factor of 1.0. The tool also defaults to 1.0 for any GEOID not found in the CSV. Both behaviors are consistent.

**"The TAZ field names have commas in numeric values (e.g., '1,010')"**
If the exported TAZ layer stored population values as text strings with comma formatting, you need to clean them before calculating growth factors. In the Calculate Field step, use:
```python
float(str(!POP_2030!).replace(',', '')) / float(str(!POP_2020!).replace(',', '')) if !POP_2020! else 1.0
```
Or clean the fields first using a single Calculate Field pass: `float(str(!POP_2020!).replace(',', ''))` into a new numeric field.

---

## Reusing This File on Future Projects

The growth factor CSV covers the entire metro area. For future projects in the same region:

- **Same MPO projection vintage:** Reuse the existing CSV as-is
- **Updated MPO projections:** Re-run from Part 3 onward with the new TAZ data
- **Different metro area with different MPO:** Start from Part 1 with that MPO's TAZ layer and the relevant state's census tracts

The crosswalk methodology is the same regardless of MPO — any TAZ dataset with baseline and projected population values can be processed this way.
