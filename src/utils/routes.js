const ORS_API_KEY =
  "eyJvcmciOiI1YjNjZTM1OTc4NTExMTAwMDFjZjYyNDgiLCJpZCI6ImZmM2ZiNDJjNjEzODQzZDFhMDQ0ODFiY2RjMDM2MjJjIiwiaCI6Im11cm11cjY0In0="; // Replace with your key

export async function fetchRoute(start, end) {
  const url =
    "https://api.openrouteservice.org/v2/directions/driving-car/geojson";

  const body = {
    coordinates: [
      [start.lng, start.lat], // note lon, lat order
      [end.lng, end.lat],
    ],
  };

  const resp = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: ORS_API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) throw new Error("Failed to fetch route");

  const data = await resp.json();

  // data.features[0].geometry.coordinates is array of [lon, lat] pairs for the route
  // Convert to [lat, lon] pairs for Leaflet
  return data.features[0].geometry.coordinates.map(([lon, lat]) => [lat, lon]);
}
