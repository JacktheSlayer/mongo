const express = require("express");
const http = require("http");
const mongoose = require("mongoose");
const socketIo = require("socket.io");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");

const JWT_SECRET =
  "e3ff5f077839c1331b1d893a728246685cb7dba9e3a77bffe7d52eaccf660988";

const app = express();
const server = http.createServer(app);
const io = socketIo(server, { cors: { origin: "*" } });

// Middleware
app.use(cors());
app.use(express.json());

// ===== MongoDB connection (branch2 style) =====
mongoose.connect("mongodb://localhost:27017/mydatabase", {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

// ===== MongoDB Schemas and Models =====
const UserSchema = new mongoose.Schema({
  username: { type: String, unique: true },
  passwordHash: String,
});
const User = mongoose.model("User", UserSchema);

const GroupSchema = new mongoose.Schema({
  name: String,
  code: { type: String, unique: true },
  members: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
  geofenceRadiusKm: { type: Number, default: 1 }, // from branch1
});
const Group = mongoose.model("Group", GroupSchema);

const LocationSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  group: { type: mongoose.Schema.Types.ObjectId, ref: "Group" },
  location: {
    type: { type: String, enum: ["Point"], required: true },
    coordinates: { type: [Number], required: true }, // [lng, lat]
  },
  speed: Number,
  lastUpdated: Date,
});
LocationSchema.index({ location: "2dsphere" });
const Location = mongoose.model("Location", LocationSchema, "map");

// In-memory data stores
const groupDestinations = {};
const confirmedDestinations = {};

// ===== Authentication middleware =====
function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ error: "Unauthorized" });
  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err) return res.status(401).json({ error: "Unauthorized" });
    req.userId = decoded.userId;
    next();
  });
}

// Haversine formula (branch1 + branch2 use)
function haversine(lat1, lon1, lat2, lon2) {
  const toRad = (v) => (v * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// ===== Authentication routes =====
app.post("/api/register", async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password)
    return res.status(400).json({ error: "Missing fields" });

  const passwordHash = await bcrypt.hash(password, 10);
  try {
    await User.create({ username, passwordHash });
    res.status(201).json({ message: "User created" });
  } catch {
    res.status(400).json({ error: "Username taken" });
  }
});

app.post("/api/login", async (req, res) => {
  const { username, password } = req.body;
  const user = await User.findOne({ username });
  if (!user) return res.status(401).json({ error: "Invalid credentials" });

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) return res.status(401).json({ error: "Invalid credentials" });

  const token = jwt.sign({ userId: user._id }, JWT_SECRET);
  res.json({ token, username });
});

// ===== Group management =====
app.post("/api/group/create", authMiddleware, async (req, res) => {
  const { name } = req.body;
  const code = Math.random().toString(36).slice(2, 8).toUpperCase();
  const group = await Group.create({ name, code, members: [req.userId] });
  res.json(group);
});

app.post("/api/group/join", authMiddleware, async (req, res) => {
  const { code } = req.body;
  const group = await Group.findOne({ code });
  if (!group) return res.status(404).json({ error: "Group not found" });
  if (!group.members.includes(req.userId)) {
    group.members.push(req.userId);
    await group.save();
  }
  res.json(group);
});

// Set geofence radius (branch1)
app.post("/api/group/geofence-radius", authMiddleware, async (req, res) => {
  const { groupId, radiusKm } = req.body;
  if (!groupId || !radiusKm)
    return res.status(400).json({ error: "Missing fields" });

  const group = await Group.findByIdAndUpdate(
    groupId,
    { geofenceRadiusKm: radiusKm },
    { new: true }
  );
  if (!group) return res.status(404).json({ error: "Group not found" });

  res.json({ message: `Geofence radius set to ${radiusKm} km`, radiusKm });
});

// ===== Location handling =====
app.post("/api/location/update", authMiddleware, async (req, res) => {
  const { groupId, lat, lng, speed } = req.body;
  if (!groupId || lat === undefined || lng === undefined)
    return res.status(400).json({ error: "Missing location data" });

  const group = await Group.findById(groupId);
  if (!group) return res.status(404).json({ error: "Group not found" });

  const locationDoc = await Location.findOneAndUpdate(
    { user: req.userId, group: groupId },
    {
      location: { type: "Point", coordinates: [lng, lat] },
      speed,
      lastUpdated: new Date(),
    },
    { upsert: true, new: true }
  ).populate("user", "username");

  io.to(groupId).emit("locationUpdate", {
    userId: req.userId,
    username: locationDoc.user?.username,
    lat,
    lng,
    speed,
    lastUpdated: locationDoc.lastUpdated,
  });

  // Geofence check (branch1)
  const radiusKm = group.geofenceRadiusKm || 1;
  const radiusRad = radiusKm / 6371;

  const nearbyFriends = await Location.find({
    group: groupId,
    user: { $ne: req.userId },
    location: {
      $geoWithin: {
        $centerSphere: [[lng, lat], radiusRad],
      },
    },
  }).populate("user", "username");

  if (nearbyFriends.length > 0) {
    nearbyFriends.forEach((f) => {
      io.to(groupId).emit("geofenceAlert", {
        userId: f.user._id,
        username: f.user.username,
        lat: f.location.coordinates[1],
        lng: f.location.coordinates[0],
        message: `${f.user.username} is within ${radiusKm} km!`,
      });
    });
  }

  res.sendStatus(200);
});

// Nearby friends API (branch2)
app.get("/api/friends/nearby", authMiddleware, async (req, res) => {
  const { lat, lng, maxDistance } = req.query;
  if (!lat || !lng) return res.status(400).json({ error: "lat and lng required" });

  try {
    const nearby = await Location.find({
      location: {
        $near: {
          $geometry: {
            type: "Point",
            coordinates: [parseFloat(lng), parseFloat(lat)],
          },
          $maxDistance: parseInt(maxDistance) || 2000,
        },
      },
    }).populate("user", "username");

    res.json(
      nearby.map((l) => ({
        userId: l.user._id,
        username: l.user.username,
        lat: l.location.coordinates[1],
        lng: l.location.coordinates[0],
        speed: l.speed,
      }))
    );
  } catch (err) {
    console.error("Error finding nearby friends:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Nearest member API (branch2)
app.get("/api/group/:code/nearest", authMiddleware, async (req, res) => {
  const { lat, lng } = req.query;
  if (!lat || !lng) return res.status(400).json({ error: "Missing lat/lng" });

  const group = await Group.findOne({ code: req.params.code });
  if (!group) return res.status(404).send("Group not found");

  try {
    const nearest = await Location.findOne({
      group: group._id,
      location: {
        $near: {
          $geometry: { type: "Point", coordinates: [parseFloat(lng), parseFloat(lat)] },
          $maxDistance: 5000,
        },
      },
    }).populate("user", "username");

    if (!nearest) return res.status(404).json({ error: "No nearby members found" });

    res.json({
      userId: nearest.user._id,
      username: nearest.user.username,
      lat: nearest.location.coordinates[1],
      lng: nearest.location.coordinates[0],
      speed: nearest.speed,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// Get all locations (branch1 + branch2)
app.get("/api/location/:code", authMiddleware, async (req, res) => {
  const group = await Group.findOne({ code: req.params.code });
  if (!group) return res.status(404).json({ error: "Group not found" });

  const locs = await Location.find({ group: group._id }).populate("user");
  res.json(
    locs.map((l) => ({
      userId: l.user._id,
      username: l.user.username,
      lat: l.location.coordinates[1],
      lng: l.location.coordinates[0],
      speed: l.speed,
    }))
  );
});

// ===== Destination proposal & confirmation =====
app.post("/api/group/set-destination", authMiddleware, (req, res) => {
  const { groupId, lat, lng } = req.body;
  if (!groupId || lat === undefined || lng === undefined) {
    return res.status(400).json({ error: "Invalid destination data" });
  }

  groupDestinations[groupId] = { lat, lng };
  confirmedDestinations[groupId] = false;

  io.to(groupId).emit("destinationProposal", { lat, lng });
  res.json({ message: "Destination proposed, awaiting confirmation" });
});

app.post("/api/group/confirm-destination", authMiddleware, (req, res) => {
  const { groupId } = req.body;
  if (!groupDestinations[groupId]) {
    return res.status(400).json({ error: "No pending destination to confirm" });
  }

  confirmedDestinations[groupId] = true;
  io.to(groupId).emit("destinationConfirmed", groupDestinations[groupId]);
  res.json({ message: "Destination confirmed" });
});

// ===== Socket.io handling =====
io.on("connection", (socket) => {
  socket.on("joinGroup", (groupId) => {
    socket.join(groupId);
  });
});

// ===== Simulation loop =====
const SIM_INTERVAL_MS = 1000;
setInterval(async () => {
  for (const groupId in confirmedDestinations) {
    if (!confirmedDestinations[groupId]) continue;
    const dest = groupDestinations[groupId];
    if (!dest) continue;

    const friends = await Location.find({ group: groupId }).populate("user");
    for (const friend of friends) {
      if (!friend.location || !friend.location.coordinates) continue;

      const [lng, lat] = friend.location.coordinates;
      const speed =
        friend.speed && friend.speed > 0 ? friend.speed : 3 + Math.random() * 20;

      const dist = haversine(lat, lng, dest.lat, dest.lng);
      if (dist < 0.05) {
        if (friend.speed !== 0) {
          io.to(groupId).emit("userArrived", {
            userId: friend.user._id,
            username: friend.user.username,
            message: `${friend.user.username} has reached the destination!`,
          });
        }
        await Location.findByIdAndUpdate(friend._id, {
          location: { type: "Point", coordinates: [dest.lng, dest.lat] },
          speed: 0,
          lastUpdated: new Date(),
        });
        continue;
      }

      const fraction = (speed * (SIM_INTERVAL_MS / 1000)) / 3600 / dist;
      const newLat = lat + (dest.lat - lat) * fraction;
      const newLng = lng + (dest.lng - lng) * fraction;

      const updated = await Location.findByIdAndUpdate(
        friend._id,
        {
          location: { type: "Point", coordinates: [newLng, newLat] },
          speed,
          lastUpdated: new Date(),
        },
        { new: true }
      );

      io.to(groupId).emit("locationUpdate", {
        userId: updated.user._id,
        username: updated.user.username,
        lat: newLat,
        lng: newLng,
        speed,
        lastUpdated: updated.lastUpdated,
      });
    }
  }
}, SIM_INTERVAL_MS);

// ===== Start server =====
const PORT = 5000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
