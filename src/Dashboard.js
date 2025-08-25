import React, { useEffect, useState, useContext } from "react";
import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
  Polyline,
} from "react-leaflet";
import "leaflet/dist/leaflet.css";
import { SocketContext } from "./App";
import L from "leaflet";

// Custom marker icon fix for leaflet in React
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: require("leaflet/dist/images/marker-icon-2x.png"),
  iconUrl: require("leaflet/dist/images/marker-icon.png"),
  shadowUrl: require("leaflet/dist/images/marker-shadow.png"),
});

export default function Dashboard({ token, username, logout, socket }) {
  const [groupCode, setGroupCode] = useState("");
  const [isJoined, setIsJoined] = useState(false);
  const [groupName, setGroupName] = useState("");
  const [locations, setLocations] = useState({});
  const [start, setStart] = useState("");
  const [destination, setDestination] = useState("");
  const [routeCoords, setRouteCoords] = useState([]);

  useEffect(() => {
    if (isJoined && groupCode) {
      socket.emit("joinGroup", groupCode);
      socket.on("locationUpdate", (loc) => {
        setLocations((prev) => ({ ...prev, [loc.userId]: loc }));
      });
    }
    return () => socket.off("locationUpdate");
  }, [isJoined, groupCode, socket]);

  const joinGroup = async () => {
    if (!groupCode) return alert("Enter group code");
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
      setGroupName(group.name);
      setIsJoined(true);
    } else {
      alert("Failed to join group");
    }
  };

  const createGroup = async () => {
    const name = prompt("Enter group name");
    if (!name) return;
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
      setGroupCode(group.code);
      setGroupName(group.name);
      setIsJoined(true);
    } else {
      alert("Failed to create group");
    }
  };

  // Send dummy location update for demo on button click (replace with real GPS in production)
  const sendLocationUpdate = async () => {
    if (!isJoined) return alert("Join a group first");
    const lat = 9.925 + Math.random() * 0.01;
    const lng = 78.12 + Math.random() * 0.01;
    const speed = 20 + Math.random() * 15;
    await fetch("http://localhost:5000/api/location/update", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ groupId: groupCode, lat, lng, speed }),
    });
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
          <button onClick={sendLocationUpdate}>
            Send Random Location Update
          </button>
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
            {routeCoords.length > 0 && (
              <Polyline positions={routeCoords} color="blue" />
            )}
          </MapContainer>
        </>
      )}
    </div>
  );
}
