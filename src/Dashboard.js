import React, { useEffect, useState } from "react";
import { fetchRoute } from "./utils/routes"; // your route fetching helper function
import { jwtDecode } from "jwt-decode";
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
import { useMapEvents } from "react-leaflet";

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

const haversine = (lat1, lng1, lat2, lng2) => {
  const toRad = (v) => (v * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

function getCurrentUserId() {
  const token = localStorage.getItem("token");
  if (!token) return null;
  try {
    const decoded = jwtDecode(token);
    return decoded.userId;
  } catch {
    return null;
  }
}

export default function Dashboard({ token, username, logout, socket }) {
  const [groupCode, setGroupCode] = useState("");
  const [groupId, setGroupId] = useState("");
  const [isJoined, setIsJoined] = useState(false);
  const [groupName, setGroupName] = useState("");
  const [locations, setLocations] = useState({});
  const [userColors, setUserColors] = useState({});
  const [meetingPoint, setMeetingPoint] = useState(null);
  const [destinationProposed, setDestinationProposed] = useState(false);
  const [routeCoords, setRouteCoords] = useState([]);
  const [isSettingDestination, setIsSettingDestination] = useState(false);

  function MapClickHandler({ onClick }) {
    useMapEvents({
      click(e) {
        onClick(e);
      },
    });
    return null;
  }
  // Assign colors to users
  useEffect(() => {
    const userIds = Object.keys(locations);
    setUserColors((prev) => {
      const colors = { ...prev };
      let index = Object.keys(colors).length;
      userIds.forEach((id) => {
        if (!colors[id]) {
          colors[id] = COLORS[index % COLORS.length];
          index++;
        }
      });
      return colors;
    });
  }, [locations]);

  const getUserColor = (userId) => userColors[userId] || "red";

  // Fetch route whenever the meeting point or current user changes
  useEffect(() => {
    const tokenUserId = getCurrentUserId();
    if (!meetingPoint || !locations[tokenUserId]) return;

    const userLoc = locations[tokenUserId];
    if (!userLoc) return;

    const start = { lat: userLoc.lat, lng: userLoc.lng };
    const end = { lat: meetingPoint[0], lng: meetingPoint[1] };
    fetchRoute(start, end)
      .then((coords) => setRouteCoords(coords))
      .catch((err) => {
        console.error("Error fetching route:", err);
        setRouteCoords([]);
      });
  }, [meetingPoint, locations]);

  // Socket event handlers and join room
  useEffect(() => {
    if (!socket || !isJoined || !groupCode) return;

    socket.emit("joinGroup", groupId);

    const locationHandler = (loc) => {
      setLocations((prev) => ({ ...prev, [loc.userId]: loc }));
    };

    const destProposalHandler = (dest) => {
      const accept = window.confirm(
        `User proposed new destination at (${dest.lat.toFixed(
          5
        )}, ${dest.lng.toFixed(5)}). Accept?`
      );
      if (accept) {
        fetch("http://localhost:5000/api/group/confirm-destination", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ groupId }),
        }).then((res) =>
          console.log("Confirmed destination response:", res.status)
        );
      }
      setDestinationProposed(true);
    };

    const destConfirmedHandler = (dest) => {
      setMeetingPoint([dest.lat, dest.lng]);
      setDestinationProposed(false);
    };

    const userArrivedHandler = (info) => {
      alert(info.message);
    };

    socket.on("locationUpdate", locationHandler);
    socket.on("destinationProposal", destProposalHandler);
    socket.on("destinationConfirmed", destConfirmedHandler);
    socket.on("userArrived", userArrivedHandler);

    return () => {
      socket.off("locationUpdate", locationHandler);
      socket.off("destinationProposal", destProposalHandler);
      socket.off("destinationConfirmed", destConfirmedHandler);
      socket.off("userArrived", userArrivedHandler);
    };
  }, [socket, isJoined, groupCode, groupId, token]);
  const handleMapClick = (e) => {
    console.log(
      "Map clicked at",
      e.latlng,
      "isSettingDestination:",
      isSettingDestination,
      "isJoined:",
      isJoined
    );
    if (!isJoined) return;
    if (!isSettingDestination) return;

    if (window.confirm("Set this location as meeting destination?")) {
      console.log("Confirmed destination at", e.latlng);
      fetch("http://localhost:5000/api/group/set-destination", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          groupId,
          lat: e.latlng.lat,
          lng: e.latlng.lng,
        }),
      }).then((res) => console.log("Destination set response:", res.status));
      setIsSettingDestination(false);
    }
  };

  // Fetch initial locations when user joins or creates group
  const fetchInitialLocations = async (code) => {
    try {
      const res = await fetch(`http://localhost:5000/api/location/${code}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setLocations(
          data.reduce((acc, loc) => {
            acc[loc.userId] = loc;
            return acc;
          }, {})
        );
      }
    } catch (e) {
      console.error("Error fetching initial locations:", e);
    }
  };

  // Join group
  const joinGroup = async () => {
    if (!groupCode) return alert("Enter group code");
    try {
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
    } catch (e) {
      alert("Failed to join group");
    }
  };

  // Create group
  const createGroup = async () => {
    const name = prompt("Enter group name");
    if (!name) return;
    try {
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
    } catch (e) {
      alert("Failed to create group");
    }
  };

  // Send random location update
  const sendLocationUpdate = async () => {
    if (!isJoined) {
      alert("Join a group first");
      return;
    }
    const lat = 9.925 + Math.random() * 0.01;
    const lng = 78.12 + Math.random() * 0.01;
    const speed = 10 + Math.random() * 10;
    const payload = { groupId, lat, lng, speed };

    console.log("Sending location update:", payload);

    try {
      const res = await fetch("http://localhost:5000/api/location/update", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });
      console.log("Location update response status:", res.status);
    } catch (e) {
      console.error("Error sending location update:", e);
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
            <button
              onClick={() => {
                console.log("Send Random Location Update clicked");
                sendLocationUpdate();
              }}
            >
              Send Random Location Update
            </button>
            <button
              onClick={() => {
                console.log(
                  "Toggle Set Destination clicked, was",
                  isSettingDestination
                );
                setIsSettingDestination((prev) => !prev);
              }}
            >
              {isSettingDestination
                ? "Cancel Setting Destination"
                : "Set Destination"}
            </button>
          </div>

          {/* Status Table */}
          <div className="status-table">
            <table>
              <thead>
                <tr>
                  <th>User</th>
                  <th>Speed (km/h)</th>
                  <th>ETA</th>
                </tr>
              </thead>
              <tbody>
                {Object.values(locations).map((loc) => {
                  const speed = loc.speed || 0;
                  const eta =
                    meetingPoint && speed > 0
                      ? `${Math.round(
                          (haversine(
                            loc.lat,
                            loc.lng,
                            meetingPoint[0],
                            meetingPoint[1]
                          ) /
                            speed) *
                            60
                        )} min`
                      : "N/A";

                  // Calculate badge color based on speed
                  let speedColor = "grey";
                  if (speed > 15) speedColor = "green";
                  else if (speed > 7) speedColor = "orange";
                  else if (speed > 0) speedColor = "red";

                  return (
                    <tr key={loc.userId}>
                      <td>{loc.username}</td>
                      <td>
                        <span
                          style={{
                            display: "inline-block",
                            width: "40px",
                            padding: "2px 6px",
                            borderRadius: "12px",
                            backgroundColor: speedColor,
                            color: "white",
                            textAlign: "center",
                            fontWeight: "bold",
                          }}
                        >
                          {speed.toFixed(1)} km/h
                        </span>
                      </td>
                      <td>{eta}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Map */}
          <div className="map-container">
            <MapContainer
              center={[9.925, 78.12]}
              zoom={13}
              style={{ height: "60vh", width: "100%" }}
              // Map click handler separated for clarity
              onClick={handleMapClick}
            >
              <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
              <MapClickHandler onClick={handleMapClick} />
              {Object.values(locations).map((loc) => {
                const color = getUserColor(loc.userId);
                return (
                  <Marker
                    key={loc.userId}
                    position={[loc.lat, loc.lng]}
                    icon={createColoredIcon(color)}
                  >
                    <Popup>
                      <b>{loc.username}</b>
                      <br />
                      Speed: {loc.speed?.toFixed(1) || "0"} km/h
                    </Popup>
                  </Marker>
                );
              })}
              {meetingPoint && (
                <Marker position={meetingPoint}>
                  <Popup>Meeting Point</Popup>
                </Marker>
              )}
              {routeCoords.length > 0 && <Polyline positions={routeCoords} />}
            </MapContainer>
          </div>
        </>
      )}
    </div>
  );
}
