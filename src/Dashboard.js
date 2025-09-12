import React, { useEffect, useState } from "react";
import { fetchRoute } from "./utils/routes";
import jwtDecode from "jwt-decode";
import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
  Polyline,
  Circle,
  useMapEvents,
} from "react-leaflet";
import "leaflet/dist/leaflet.css";
import L from "leaflet";
import "./Dashboard.css";

// Function to create a colored marker
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

// Special icon for geofence alert
const geofenceIcon = new L.Icon({
  iconUrl:
    "https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-gold.png",
  shadowUrl:
    "https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png",
  iconSize: [30, 45],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

const COLORS = ["red", "blue", "green", "orange", "yellow", "violet", "grey", "black"];

// Haversine formula to calculate distance between two coordinates
const haversine = (lat1, lng1, lat2, lng2) => {
  const toRad = (v) => (v * Math.PI) / 180;
  const R = 6371; // km
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

// Extract user ID from token
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
  const [routeCoords, setRouteCoords] = useState([]);
  const [isSettingDestination, setIsSettingDestination] = useState(false);
  const [destinationProposed, setDestinationProposed] = useState(false);

  const [geofenceUsers, setGeofenceUsers] = useState(new Set());
  const [geofenceRadius, setGeofenceRadius] = useState(1);

  // Map click handler component
  function MapClickHandler({ onClick }) {
    useMapEvents({
      click(e) {
        onClick(e);
      },
    });
    return null;
  }

  // Assign a unique color to each user
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

  // Determine readable text color
  const getTextColor = (bgColor) => {
    const lightColors = ["yellow", "orange"];
    return lightColors.includes(bgColor) ? "black" : "white";
  };

  // Fetch route when meeting point changes
  useEffect(() => {
    const tokenUserId = getCurrentUserId();
    if (!meetingPoint || !locations[tokenUserId]) return;
    const userLoc = locations[tokenUserId];
    const start = { lat: userLoc.lat, lng: userLoc.lng };
    const end = { lat: meetingPoint[0], lng: meetingPoint[1] };
    fetchRoute(start, end)
      .then((coords) => setRouteCoords(coords))
      .catch(() => setRouteCoords([]));
  }, [meetingPoint, locations]);

  // Socket event handlers
  useEffect(() => {
    if (!socket || !isJoined || !groupCode) return;

    socket.emit("joinGroup", groupId);

    const locationHandler = (loc) => {
      // Preserve username during updates
      setLocations((prev) => ({
        ...prev,
        [loc.userId]: { ...prev[loc.userId], ...loc },
      }));
      if (geofenceUsers.has(loc.userId)) {
        const dist = haversine(
          loc.lat,
          loc.lng,
          locations[getCurrentUserId()]?.lat || loc.lat,
          locations[getCurrentUserId()]?.lng || loc.lng
        );
        if (dist > geofenceRadius) {
          setGeofenceUsers((prev) => {
            const updated = new Set(prev);
            updated.delete(loc.userId);
            return updated;
          });
        }
      }
    };

    const geofenceHandler = (alert) => {
      setGeofenceUsers((prev) => new Set(prev).add(alert.userId));
      alert.message && window.alert(alert.message);
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
        });
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
    socket.on("geofenceAlert", geofenceHandler);
    socket.on("destinationProposal", destProposalHandler);
    socket.on("destinationConfirmed", destConfirmedHandler);
    socket.on("userArrived", userArrivedHandler);

    return () => {
      socket.off("locationUpdate", locationHandler);
      socket.off("geofenceAlert", geofenceHandler);
      socket.off("destinationProposal", destProposalHandler);
      socket.off("destinationConfirmed", destConfirmedHandler);
      socket.off("userArrived", userArrivedHandler);
    };
  }, [
    socket,
    isJoined,
    groupCode,
    groupId,
    geofenceUsers,
    locations,
    geofenceRadius,
    token,
  ]);

  // Handle map click for setting destination
  const handleMapClick = (e) => {
    if (!isJoined || !isSettingDestination) return;
    if (window.confirm("Set this location as meeting destination?")) {
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
      });
      setIsSettingDestination(false);
    }
  };

  // Fetch initial locations
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
      } else alert("Failed to join group");
    } catch {
      alert("Failed to join group");
    }
  };

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
      } else alert("Failed to create group");
    } catch {
      alert("Failed to create group");
    }
  };

  const sendLocationUpdate = async () => {
    if (!isJoined) return alert("Join a group first");
    const lat = 9.925 + Math.random() * 0.01;
    const lng = 78.12 + Math.random() * 0.01;
    const speed = 10 + Math.random() * 10;
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
    } catch (e) {
      console.error("Error sending location update:", e);
    }
  };

  const handleRadiusChange = async (newRadius) => {
    setGeofenceRadius(newRadius);
    if (!groupId) return;
    try {
      await fetch("http://localhost:5000/api/group/geofence-radius", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ groupId, radiusKm: newRadius }),
      });
    } catch (e) {
      console.error("Failed to update geofence radius:", e);
    }
  };

  // Fixed nearest friend logic
  const findNearestFriend = () => {
    const myId = getCurrentUserId();
    const myLoc = locations[myId];
    if (!myLoc) return alert("No current location found");
    let nearest = null;
    let minDist = Infinity;
    Object.values(locations).forEach((loc) => {
      if (loc.userId === myId) return; // exclude self
      const dist = haversine(myLoc.lat, myLoc.lng, loc.lat, loc.lng);
      if (dist < minDist) {
        minDist = dist;
        nearest = loc;
      }
    });
    if (nearest) {
      alert(`Nearest friend: ${nearest.username} (${minDist.toFixed(2)} km away)`);
      setMeetingPoint([nearest.lat, nearest.lng]); // update locally
    } else alert("No friends nearby");
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
            <button onClick={sendLocationUpdate}>Send Random Location Update</button>
            <button onClick={() => setIsSettingDestination((p) => !p)}>
              {isSettingDestination ? "Cancel Setting Destination" : "Set Destination"}
            </button>
            <button onClick={findNearestFriend}>Find Nearest Friend</button>
          </div>

          <div className="geofence-control">
            <label>
              Geofence Radius: {geofenceRadius} km
              <input
                type="range"
                min="0.5"
                max="10"
                step="0.5"
                value={geofenceRadius}
                onChange={(e) => handleRadiusChange(parseFloat(e.target.value))}
              />
            </label>
          </div>

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
                          (haversine(loc.lat, loc.lng, meetingPoint[0], meetingPoint[1]) / speed) *
                            60
                        )} min`
                      : "N/A";
                  const color = getUserColor(loc.userId);
                  const textColor = getTextColor(color);
                  return (
                    <tr key={loc.userId}>
                      <td>{loc.username}</td>
                      <td>
                        <span
                          className={`speed-badge speed-${color}`}
                          style={{ color: textColor }}
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

          <div className="map-container">
            <MapContainer
              center={[9.925, 78.12]}
              zoom={13}
              style={{ height: "60vh", width: "100%" }}
              onClick={handleMapClick}
            >
              <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
              <MapClickHandler onClick={handleMapClick} />

              {Object.values(locations).map((loc) => {
                const isAlerted = geofenceUsers.has(loc.userId);
                const color = getUserColor(loc.userId);
                return (
                  <React.Fragment key={loc.userId}>
                    <Marker
                      position={[loc.lat, loc.lng]}
                      icon={isAlerted ? geofenceIcon : createColoredIcon(color)}
                    >
                      <Popup>
                        <b>{loc.username}</b>
                        <br />
                        Speed: {loc.speed?.toFixed(1) || "0"} km/h
                        {isAlerted && (
                          <div style={{ color: "red" }}>
                            ⚠ Within {geofenceRadius} km!
                          </div>
                        )}
                      </Popup>
                    </Marker>
                    {isAlerted && (
                      <Circle
                        center={[loc.lat, loc.lng]}
                        radius={geofenceRadius * 1000}
                        pathOptions={{ color: "gold", fillOpacity: 0.1 }}
                      />
                    )}
                  </React.Fragment>
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
