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
import "./Dashboard.css";

// Marker icon factory
const createColoredIcon = (color) =>
  new L.Icon({
    iconUrl: `https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-${color}.png`,
    shadowUrl:
      "https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png",
    iconSize: [25, 41],
    iconAnchor: [12, 41],
    popupAnchor: [1, -34],
    shadowSize: [41, 41],
  });

// Define color pool
const COLORS = [
  "red",
  "blue",
  "green",
  "orange",
  "yellow",
  "violet",
  "grey",
  "black",
];

export default function Dashboard({ token, username, logout, socket }) {
  const [groupCode, setGroupCode] = useState("");
  const [groupId, setGroupId] = useState("");
  const [isJoined, setIsJoined] = useState(false);
  const [groupName, setGroupName] = useState("");
  const [locations, setLocations] = useState({});
  const [routeCoords, setRouteCoords] = useState([]);
  const [userColors, setUserColors] = useState({});

  // Assign a color to a user consistently
  const getUserColor = (userId) => {
    if (userColors[userId]) return userColors[userId];
    const availableColor =
      COLORS[Object.keys(userColors).length % COLORS.length];
    setUserColors((prev) => ({ ...prev, [userId]: availableColor }));
    return availableColor;
  };

  useEffect(() => {
    const handler = (loc) => {
      console.log("[SOCKET] Received locationUpdate:", loc);
      getUserColor(loc.userId); // Assign color if new
      setLocations((prev) => ({ ...prev, [loc.userId]: loc }));
    };

    if (isJoined && groupCode) {
      socket.emit("joinGroup", groupCode);
      socket.on("locationUpdate", handler);
    }

    return () => {
      socket.off("locationUpdate", handler);
    };
  }, [isJoined, groupCode, socket]);

  const fetchInitialLocations = async (code) => {
    try {
      const res = await fetch(`http://localhost:5000/api/location/${code}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        data.forEach((loc) => getUserColor(loc.userId));
        setLocations(
          data.reduce((acc, loc) => {
            acc[loc.userId] = loc;
            return acc;
          }, {})
        );
      }
    } catch (err) {
      console.error("Error fetching initial locations:", err);
    }
  };

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
      setGroupId(group._id);
      setIsJoined(true);
      await fetchInitialLocations(group.code);
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
      setGroupId(group._id);
      setGroupName(group.name);
      setIsJoined(true);
      await fetchInitialLocations(group.code);
    } else {
      alert("Failed to create group");
    }
  };

  const sendLocationUpdate = async () => {
    if (!isJoined) return alert("Join a group first");
    const lat = 9.925 + Math.random() * 0.01;
    const lng = 78.12 + Math.random() * 0.01;
    const speed = 20 + Math.random() * 15;
    const payload = { groupId, lat, lng, speed };

    try {
      await fetch("http://localhost:5000/api/location/update", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });
    } catch (err) {
      console.error("Error sending location update:", err);
    }
  };

  return (
    <div className="dashboard-container">
      <div className="dashboard-header">
        <h1>Hello, {username}</h1>
        <button onClick={logout}>Logout</button>
      </div>

      {!isJoined ? (
        <div className="group-section">
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
          <div className="group-info">
            <h2>
              Group: {groupName} (Code: {groupCode})
            </h2>
            <button onClick={sendLocationUpdate}>
              Send Random Location Update
            </button>
          </div>

          {/* Map */}
          <div className="map-container">
            <MapContainer
              center={[9.925, 78.12]}
              zoom={13}
              style={{ height: "60vh", width: "100%" }}
            >
              <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
              {Object.values(locations).map((l) => {
                const color = getUserColor(l.userId);
                return (
                  <Marker
                    key={l.userId}
                    position={[l.lat, l.lng]}
                    icon={createColoredIcon(color)}
                  >
                    <Popup>
                      <b>{l.username}</b>
                      <br />
                      Speed: {l.speed?.toFixed(1) || "0"} km/h
                    </Popup>
                  </Marker>
                );
              })}
              {routeCoords.length > 0 && <Polyline positions={routeCoords} />}
            </MapContainer>
          </div>

          {/* User Table */}
          <div className="user-table">
            <h3>Group Members</h3>
            <table>
              <thead>
                <tr>
                  <th>User</th>
                  <th>Speed</th>
                  <th>Color</th>
                </tr>
              </thead>
              <tbody>
                {Object.values(locations).map((l) => {
                  const color = getUserColor(l.userId);
                  return (
                    <tr key={l.userId}>
                      <td>{l.username}</td>
                      <td>{l.speed?.toFixed(1) || "0"} km/h</td>
                      <td>
                        <span
                          style={{
                            display: "inline-block",
                            width: "20px",
                            height: "20px",
                            backgroundColor: color,
                            borderRadius: "50%",
                          }}
                        ></span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
