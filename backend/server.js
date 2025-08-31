const express = require("express");
const http = require("http");
const mongoose = require("mongoose");
const socketIo = require("socket.io");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");

const JWT_SECRET = "your_jwt_secret"; // set strong secret in production
const app = express();
const server = http.createServer(app);
const io = socketIo(server, { cors: { origin: "*" } });

app.use(cors());
app.use(express.json());

// Connect to MongoDB 'maps' database
mongoose.connect("mongodb://localhost:27017/maps", {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

// -- Mongoose Schemas --

// User schema
const UserSchema = new mongoose.Schema({
  username: { type: String, unique: true },
  passwordHash: String,
});
const User = mongoose.model("User", UserSchema);

// Group schema
const GroupSchema = new mongoose.Schema({
  name: String,
  code: { type: String, unique: true }, // shareable unique code
  members: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
});
const Group = mongoose.model("Group", GroupSchema);

// Location schema - Use collection "map"
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
const Location = mongoose.model("Location", LocationSchema, "map"); // explicit collection name

// -- Authentication APIs --

app.post("/api/register", async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).send("Missing fields");
  const passwordHash = await bcrypt.hash(password, 10);
  try {
    const user = await User.create({ username, passwordHash });
    res.status(201).json({ message: "User created" });
  } catch (e) {
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

// JWT Auth Middleware
function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ error: "Unauthorized" });
  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err) return res.status(401).json({ error: "Unauthorized" });
    req.userId = decoded.userId;
    next();
  });
}

// -- Group APIs --

app.post("/api/group/create", authMiddleware, async (req, res) => {
  const { name } = req.body;
  const code = Math.random().toString(36).slice(2, 8).toUpperCase();
  const group = await Group.create({ name, code, members: [req.userId] });
  res.json(group);
});

app.post("/api/group/join", authMiddleware, async (req, res) => {
  const { code } = req.body;
  const group = await Group.findOne({ code });
  if (!group) return res.status(404).send("Group not found");
  if (!group.members.includes(req.userId)) {
    group.members.push(req.userId);
    await group.save();
  }
  res.json(group);
});

// -- Location APIs --
app.get("/api/location/:groupCode", authMiddleware, async (req, res) => {
  const { groupCode } = req.params;
  const group = await Group.findOne({ code: groupCode });
  if (!group) return res.status(404).send("Group not found");

  const locations = await Location.find({ group: group._id })
    .populate("user", "username");

  res.json(
    locations.map((l) => ({
      userId: l.user._id,
      username: l.user.username,
      lat: l.location.coordinates[1],
      lng: l.location.coordinates[0],
      speed: l.speed,
    }))
  );
});

// -- Location APIs --
app.post("/api/location/update", authMiddleware, async (req, res) => {
  const { groupId, lat, lng, speed } = req.body;
  console.log("[API] /api/location/update hit - payload:", { groupId, lat, lng, speed, userId: req.userId });

  if (!groupId || lat === undefined || lng === undefined) {
    console.log("[API] Missing data in /api/location/update");
    return res.status(400).json({ error: "Missing location data" });
  }

  try {
    const group = await Group.findById(groupId);
    if (!group) {
      console.log("[API] Group not found for ID:", groupId);
      return res.status(404).json({ error: "Group not found" });
    }

    const updatedLocation = await Location.findOneAndUpdate(
      { user: req.userId, group: groupId },
      {
        location: { type: "Point", coordinates: [lng, lat] },
        speed,
        lastUpdated: new Date(),
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    ).populate("user", "username");

    const userId = updatedLocation.user?._id || req.userId;
    const username = updatedLocation.user?.username || "unknown";

    console.log(`[API] Saved location for user ${username} (${userId}). Broadcasting to room: ${group.code}`);

    io.to(group.code).emit("locationUpdate", {
      userId,
      username,
      lat,
      lng,
      speed,
      lastUpdated: updatedLocation.lastUpdated,
    });

    console.log("[API] Broadcast complete");
    return res.sendStatus(200);
  } catch (err) {
    console.error("[API] Error in /api/location/update:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// -- Socket.io Real-time --
io.on("connection", (socket) => {
  console.log("[IO] socket connected:", socket.id);

  socket.on("joinGroup", (groupCode) => {
    console.log(`[IO] socket ${socket.id} joining room ${groupCode}`);
    socket.join(groupCode);
  });

  socket.on("disconnect", () => {
    console.log("[IO] socket disconnected:", socket.id);
  });
});

// Start server
const PORT = 5000;
server.listen(PORT, () => console.log(`Server listening on port ${PORT}`));
