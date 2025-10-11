const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const sqlite3 = require("sqlite3").verbose();
const cron = require("node-cron");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use("/static", express.static(path.join(__dirname, "public")));

const db = new sqlite3.Database("./database.db");

// Mill operating hours
const MILL_START = 9 * 60; // 9:00 AM in minutes (540)
const MILL_END = 18 * 60; // 6:00 PM in minutes (1080)
const MINUTES_PER_BAG = 15;

// Admin credentials (in production, use proper authentication with hashed passwords)
const ADMIN_USERNAME = "admin";
const ADMIN_PASSWORD = "admin123"; // Change this!

// Initialize DB
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS slots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    day TEXT,
    name TEXT,
    bags INTEGER,
    start_time INTEGER,
    end_time INTEGER,
    time_display TEXT
  )`);

  // New table for closed slots
  db.run(`CREATE TABLE IF NOT EXISTS closed_slots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    day TEXT,
    start_time INTEGER,
    end_time INTEGER,
    reason TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
});

// Helper function to convert minutes to time string
function minutesToTime(minutes) {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  const period = hours >= 12 ? "PM" : "AM";
  const displayHours = hours > 12 ? hours - 12 : hours === 0 ? 12 : hours;
  return `${displayHours}:${mins.toString().padStart(2, '0')} ${period}`;
}

// Serve main page
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public/index.html"));
});

// Serve admin page
app.get("/admin", (req, res) => {
  res.sendFile(path.join(__dirname, "public/admin.html"));
});

// Admin login
app.post("/admin/login", (req, res) => {
  const { username, password } = req.body;
  
  if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
    res.json({ success: true, message: "Login successful" });
  } else {
    res.status(401).json({ success: false, message: "Invalid credentials" });
  }
});

// API to get slots (including closed slots for display)
app.get("/slots", (req, res) => {
  db.all("SELECT * FROM slots ORDER BY day, start_time", [], (err, bookings) => {
    if (err) return res.status(500).json({ error: "Error fetching slots" });
    
    // Also get closed slots to display to users
    db.all("SELECT * FROM closed_slots ORDER BY day, start_time", [], (err, closedSlots) => {
      if (err) return res.status(500).json({ error: "Error fetching closed slots" });
      
      res.json({ bookings, closedSlots });
    });
  });
});

// Get closed slots
app.get("/admin/closed-slots", (req, res) => {
  db.all("SELECT * FROM closed_slots ORDER BY day, start_time", [], (err, rows) => {
    if (err) return res.status(500).json({ error: "Error fetching closed slots" });
    res.json(rows);
  });
});

// Check if a time range overlaps with closed slots
function isTimeRangeClosed(day, startTime, endTime, callback) {
  db.all(
    "SELECT * FROM closed_slots WHERE day = ? AND ((start_time < ? AND end_time > ?) OR (start_time < ? AND end_time > ?) OR (start_time >= ? AND end_time <= ?))",
    [day, endTime, startTime, endTime, endTime, startTime, endTime],
    (err, rows) => {
      if (err) return callback(err, null);
      callback(null, rows.length > 0);
    }
  );
}

// Get available time slots for a specific day
app.get("/available-slots", (req, res) => {
  const { day, bags } = req.query;
  
  if (!day) {
    return res.status(400).json({ error: "Day is required" });
  }
  
  const duration = bags ? parseInt(bags) * MINUTES_PER_BAG : 15;
  
  // Get both booked slots and closed slots
  db.all("SELECT * FROM slots WHERE day = ? ORDER BY start_time", [day], (err, bookedSlots) => {
    if (err) {
      console.error("Database error:", err);
      return res.status(500).json({ error: "Error fetching slots" });
    }
    
    db.all("SELECT * FROM closed_slots WHERE day = ? ORDER BY start_time", [day], (err, closedSlots) => {
      if (err) {
        console.error("Database error:", err);
        return res.status(500).json({ error: "Error fetching closed slots" });
      }
      
      const availableSlots = [];
      
      // Generate all possible 15-minute start times
      for (let time = MILL_START; time < MILL_END; time += 15) {
        const endTime = time + duration;
        
        // Check if this slot would exceed mill hours
        if (endTime > MILL_END) continue;
        
        // Check if this slot conflicts with any existing booking
        const hasBookingConflict = bookedSlots.some(booking => {
          return (time < booking.end_time && endTime > booking.start_time);
        });
        
        // Check if this slot conflicts with any closed slot
        const hasClosedConflict = closedSlots.some(closed => {
          return (time < closed.end_time && endTime > closed.start_time);
        });
        
        if (!hasBookingConflict && !hasClosedConflict) {
          availableSlots.push({
            start: time,
            end: endTime,
            display: `${minutesToTime(time)} - ${minutesToTime(endTime)}`
          });
        }
      }
      
      res.json(availableSlots);
    });
  });
});

// API to book slot
app.post("/book", (req, res) => {
  const { day, name, bags, startTime } = req.body;
  
  if (!day || !name || !bags || bags < 1 || startTime === undefined) {
    return res.status(400).json({ error: "Invalid booking data" });
  }
  
  const duration = bags * MINUTES_PER_BAG;
  const endTime = startTime + duration;
  
  // Validate time is within mill hours
  if (startTime < MILL_START || endTime > MILL_END) {
    return res.status(400).json({ error: "Booking time is outside mill operating hours" });
  }
  
  // Check if time range is closed by admin
  db.all(
    "SELECT * FROM closed_slots WHERE day = ? AND ((start_time < ? AND end_time > ?) OR (start_time < ? AND end_time > ?) OR (start_time >= ? AND end_time <= ?))",
    [day, endTime, startTime, endTime, endTime, startTime, endTime],
    (err, closedSlots) => {
      if (err) {
        console.error("Database error:", err);
        return res.status(500).json({ error: "Error checking availability" });
      }
      
      if (closedSlots.length > 0) {
        return res.status(400).json({ error: "This time slot has been closed by the administrator" });
      }
      
      // Check for conflicts with existing bookings
      db.all("SELECT * FROM slots WHERE day = ?", [day], (err, rows) => {
        if (err) {
          console.error("Database error:", err);
          return res.status(500).json({ error: "Error checking availability" });
        }
        
        const hasConflict = rows.some(booking => {
          return (startTime < booking.end_time && endTime > booking.start_time);
        });
        
        if (hasConflict) {
          return res.status(400).json({ error: "This time slot conflicts with an existing booking" });
        }
        
        const timeDisplay = `${minutesToTime(startTime)} - ${minutesToTime(endTime)}`;
        
        db.run(
          `INSERT INTO slots (day, name, bags, start_time, end_time, time_display) VALUES (?, ?, ?, ?, ?, ?)`,
          [day, name, bags, startTime, endTime, timeDisplay],
          function (err) {
            if (err) {
              console.error("Database error:", err);
              return res.status(500).json({ error: "Error booking slot" });
            }
            io.emit("update"); // notify all clients
            res.json({ 
              success: true, 
              message: "Slot booked successfully",
              timeDisplay 
            });
          }
        );
      });
    }
  );
});

// Admin: Close a time slot
app.post("/admin/close-slot", (req, res) => {
  const { day, startTime, endTime, reason } = req.body;
  
  if (!day || startTime === undefined || endTime === undefined) {
    return res.status(400).json({ error: "Invalid data" });
  }
  
  // Check if there are existing bookings in this time range
  db.all(
    "SELECT * FROM slots WHERE day = ? AND ((start_time < ? AND end_time > ?) OR (start_time < ? AND end_time > ?) OR (start_time >= ? AND end_time <= ?))",
    [day, endTime, startTime, endTime, endTime, startTime, endTime],
    (err, existingBookings) => {
      if (err) {
        console.error("Database error:", err);
        return res.status(500).json({ error: "Error checking bookings" });
      }
      
      if (existingBookings.length > 0) {
        return res.status(400).json({ 
          error: "Cannot close slot - there are existing bookings in this time range",
          bookings: existingBookings
        });
      }
      
      db.run(
        "INSERT INTO closed_slots (day, start_time, end_time, reason) VALUES (?, ?, ?, ?)",
        [day, startTime, endTime, reason || "Closed by admin"],
        function (err) {
          if (err) {
            console.error("Database error:", err);
            return res.status(500).json({ error: "Error closing slot" });
          }
          io.emit("update"); // notify all clients
          io.emit("admin-update"); // notify admin clients
          res.json({ success: true, message: "Slot closed successfully" });
        }
      );
    }
  );
});

// Admin: Open a closed slot
app.delete("/admin/close-slot/:id", (req, res) => {
  const { id } = req.params;
  
  db.run("DELETE FROM closed_slots WHERE id = ?", [id], function (err) {
    if (err) {
      console.error("Database error:", err);
      return res.status(500).json({ error: "Error opening slot" });
    }
    io.emit("update"); // notify all clients
    io.emit("admin-update"); // notify admin clients
    res.json({ success: true, message: "Slot opened successfully" });
  });
});

// Admin: Delete a booking
app.delete("/admin/booking/:id", (req, res) => {
  const { id } = req.params;
  
  db.run("DELETE FROM slots WHERE id = ?", [id], function (err) {
    if (err) {
      console.error("Database error:", err);
      return res.status(500).json({ error: "Error deleting booking" });
    }
    io.emit("update"); // notify all clients
    io.emit("admin-update"); // notify admin clients
    res.json({ success: true, message: "Booking deleted successfully" });
  });
});

// Admin: Get all bookings with details
app.get("/admin/bookings", (req, res) => {
  db.all("SELECT * FROM slots ORDER BY day, start_time", [], (err, rows) => {
    if (err) return res.status(500).json({ error: "Error fetching bookings" });
    res.json(rows);
  });
});

// Reset slots every 24 hours (midnight)
cron.schedule("0 0 * * *", () => {
  db.run("DELETE FROM slots");
  db.run("DELETE FROM closed_slots");
  io.emit("update");
  io.emit("admin-update");
  console.log("All slots and closures cleared for new day.");
});

io.on("connection", (socket) => {
  console.log("User connected");
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));