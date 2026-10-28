"""Refresh published collector metadata and the public-domain base map.
Run manually; no network metadata lookups run on the BGP ingestion path.
"""
import concurrent.futures
import datetime
import hashlib
import json
from pathlib import Path
import struct
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'frontend' / 'public' / 'geo'
SOURCE = 'https://stat.ripe.net/data/rrc-info/data.json'
LAND = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_land.geojson'

def read(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'Internet-Pulse-metadata-refresh'}), timeout=20) as response:
        return response.read()

def location(rrc):
    name = rrc['name'].lower()+'.ripe.net'
    result = dict(name=name, label=rrc['name'], location=rrc['geographical_location'],
                  scope=rrc['topological_location'], multihop=rrc['multihop'])
    answers = json.loads(read('https://dns.google/resolve?name='+name+'&type=29')).get('Answer', [])
    for answer in answers:
        if answer['type'] != 29:
            continue
        raw = bytes.fromhex(answer['data'].split()[-1])
        if len(raw) != 16 or raw[0] != 0:
            continue
        lat, lon = struct.unpack('!II', raw[4:12])
        result.update(latitude=(lat-2**31)/3600000, longitude=(lon-2**31)/3600000,
                      coordinate_source='DNS LOC '+name)
        break
    # Missing coordinates stay unlocated; never invent a city centroid.
    return result

def main():
    OUT.mkdir(parents=True, exist_ok=True)
    rrcs = [r for r in json.loads(read(SOURCE))['data']['rrcs'] if not r['deactivated_on']]
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as executor:
        collectors = list(executor.map(location, rrcs))
    land_bytes = read(LAND)
    land = json.loads(land_bytes)
    paths = []
    for feature in land['features']:
        geometry = feature['geometry']
        polygons = geometry['coordinates'] if geometry['type'] == 'MultiPolygon' else [geometry['coordinates']]
        for polygon in polygons:
            # Outer rings suffice for the small overview; no country boundaries.
            points = polygon[0]
            paths.append('M'+'L'.join(f'{(lon+180)*1000/360:.1f},{(90-lat)*500/180:.1f}' for lon,lat,*_ in points)+'Z')
    svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 500"><path fill="#172e39" stroke="#294652" stroke-width=".5" d="'+''.join(paths)+'"/></svg>'
    (OUT/'world-land.svg').write_text(svg, encoding='utf-8')
    payload = dict(updated_at=datetime.datetime.now(datetime.timezone.utc).isoformat(), source=SOURCE,
                   documentation='https://ris.ripe.net/docs/route-collectors/',
                   coordinate_source='Published rrcNN.ripe.net DNS LOC records, retrieved through DNS over HTTPS',
                   land_source=LAND, land_sha256=hashlib.sha256(land_bytes).hexdigest(),
                   land_license='Natural Earth public domain', collectors=collectors)
    (OUT/'collectors.json').write_text(json.dumps(payload, indent=2), encoding='utf-8')
    print(f'Saved {len(collectors)} collectors, {sum("latitude" in c for c in collectors)} located; SVG {len(svg)} bytes')

if __name__ == '__main__':
    main()
