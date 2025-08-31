import React, { useEffect, useState } from "react";
import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
  Polyline,
} from "react-leaflet";
import "leaflet/dist/leaflet.css";
import L from "leaflet";

// Leaflet marker fix
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: require("leaflet/dist/images/marker-icon-2x.png"),
  iconUrl: require("leaflet/dist/images/marker-icon.png"),
  shadowUrl: require("leaflet/dist/images/marker-shadow.png"),
});

export default function Dashboard({ token, username, logout, socket }) {
  const [groupCode, setGroupCode] = useState("");
  const [groupId, setGroupId] = useState("");
  const [isJoined, setIsJoined] = useState(false);
  const [groupName, setGroupName] = useState("");
  const [locations, setLocations] = useState({});
  const [routeCoords, setRouteCoords] = useState([]);

  useEffect(() => {
    const handler = (loc) => {
      console.log("[SOCKET] Received locationUpdate:", loc);
      setLocations((prev) => ({ ...prev, [loc.userId]: loc }));
    };

    if (isJoined && groupCode) {
      console.log("[SOCKET] Emitting joinGroup for code:", groupCode);
      socket.emit("joinGroup", groupCode);
      socket.on("locationUpdate", handler);
    }

    return () => {
      socket.off("locationUpdate", handler);
    };
  }, [isJoined, groupCode, socket]);

  // Fetch existing locations from server
  const fetchInitialLocations = async (code) => {
    try {
      console.log("[UI] Fetching initial locations for group:", code);
      const res = await fetch(`http://localhost:5000/api/location/${code}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        console.log("[UI] Initial locations data:", data);
        setLocations(
          data.reduce((acc, loc) => {
            acc[loc.userId] = loc;
            return acc;
          }, {})
        );
      } else {
        console.error("[UI] Failed to fetch initial locations:", res.status);
      }
    } catch (err) {
      console.error("[UI] Error fetching initial locations:", err);
    }
  };

  const joinGroup = async () => {
    if (!groupCode) return alert("Enter group code");
    console.log("[UI] Joining group with code:", groupCode);

    const res = await fetch("http://localhost:5000/api/group/join", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ code: groupCode }),
    });

    if (res.ok) {
      const group = await res.json();
      console.log("[UI] Joined group:", group);
      setGroupName(group.name);
      setGroupId(group._id);
      setIsJoined(true);
      await fetchInitialLocations(group.code);
    } else {
      const txt = await res.text().catch(() => null);
      console.error("[UI] Failed to join group:", res.status, txt);
      alert("Failed to join group");
    }
  };

  const createGroup = async () => {
    const name = prompt("Enter group name");
    if (!name) return;
    console.log("[UI] Creating group with name:", name);

    const res = await fetch("http://localhost:5000/api/group/create", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ name }),
    });

    if (res.ok) {
      const group = await res.json();
      console.log("[UI] Created group:", group);
      setGroupCode(group.code);
      setGroupId(group._id);
      setGroupName(group.name);
      setIsJoined(true);
      await fetchInitialLocations(group.code);
    } else {
      const txt = await res.text().catch(() => null);
      console.error("[UI] Failed to create group:", res.status, txt);
      alert("Failed to create group");
    }
  };

  const sendLocationUpdate = async () => {
    if (!isJoined) return alert("Join a group first");
    const lat = 9.925 + Math.random() * 0.01;
    const lng = 78.12 + Math.random() * 0.01;
    const speed = 20 + Math.random() * 15;

    const payload = { groupId, lat, lng, speed };
    console.log("[UI] Sending location update:", payload);

    try {
      const res = await fetch("http://localhost:5000/api/location/update", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });
      console.log("[UI] /api/location/update status:", res.status);
    } catch (err) {
      console.error("[UI] network error sending location update:", err);
    }
  };

  return (
    <div>
      <h1>
        Hello, {username} <button onClick={logout}>Logout</button>
      </h1>

      {!isJoined ? (
        <div>
          <input
            placeholder="Group Code"
            value={groupCode}
            onChange={(e) => setGroupCode(e.target.value.toUpperCase())}
          />
          <button onClick={joinGroup}>Join Group</button>
          <button onClick={createGroup}>Create Group</button>
        </div>
      ) : (
        <>
          <h2>
            Group: {groupName} (Code: {groupCode})
          </h2>
          <button onClick={sendLocationUpdate}>Send Random Location Update</button>
          <MapContainer
            center={[9.925, 78.12]}
            zoom={13}
            style={{ height: "70vh", width: "90vw", margin: "auto" }}
          >
            <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
            {Object.values(locations).map((l) => (
              <Marker key={l.userId} position={[l.lat, l.lng]}>
                <Popup>
                  <b>{l.username}</b>
                  <br />
                  Speed: {l.speed?.toFixed(1) || "0"} km/h
                </Popup>
              </Marker>
            ))}
            {routeCoords.length > 0 && <Polyline positions={routeCoords} />}
          </MapContainer>
        </>
      )}
    </div>
  );
}
