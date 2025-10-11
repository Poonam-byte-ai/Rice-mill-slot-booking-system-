const socket = io();

const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MILL_START = 9 * 60; // 9:00 AM
const MILL_END = 18 * 60; // 6:00 PM

let isLoggedIn = sessionStorage.getItem('adminLoggedIn') === 'true';

// Check if already logged in
if (isLoggedIn) {
  showDashboard();
}

// Helper function to convert minutes to time string
function minutesToTime(minutes) {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  const period = hours >= 12 ? "PM" : "AM";
  const displayHours = hours > 12 ? hours - 12 : hours === 0 ? 12 : hours;
  return `${displayHours}:${mins.toString().padStart(2, '0')} ${period}`;
}

// Login function
async function login() {
  const username = document.getElementById('username').value.trim();
  const password = document.getElementById('password').value;
  const errorElement = document.getElementById('login-error');

  if (!username || !password) {
    errorElement.textContent = "Please enter username and password";
    return;
  }

  try {
    const res = await fetch('/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });

    const result = await res.json();

    if (res.ok) {
      sessionStorage.setItem('adminLoggedIn', 'true');
      isLoggedIn = true;
      showDashboard();
    } else {
      errorElement.textContent = result.message || "Invalid credentials";
    }
  } catch (err) {
    errorElement.textContent = "Network error. Please try again.";
  }
}

// Allow Enter key to login
document.addEventListener('DOMContentLoaded', () => {
  const passwordInput = document.getElementById('password');
  if (passwordInput) {
    passwordInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        login();
      }
    });
  }
});

// Show dashboard
function showDashboard() {
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('admin-dashboard').style.display = 'block';
  loadBookings();
  loadClosedSlots();
  populateTimeDropdowns();
}

// Logout function
function logout() {
  sessionStorage.removeItem('adminLoggedIn');
  isLoggedIn = false;
  document.getElementById('login-screen').style.display = 'flex';
  document.getElementById('admin-dashboard').style.display = 'none';
  document.getElementById('username').value = '';
  document.getElementById('password').value = '';
}

// Tab switching
function showTab(tabName) {
  // Hide all tabs
  document.querySelectorAll('.tab-content').forEach(tab => {
    tab.classList.remove('active');
  });
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.remove('active');
  });

  // Show selected tab
  document.getElementById(tabName + '-tab').classList.add('active');
  event.target.classList.add('active');

  // Load data for the tab
  if (tabName === 'bookings') {
    loadBookings();
  } else if (tabName === 'closed-list') {
    loadClosedSlots();
  }
}

// Load all bookings
async function loadBookings() {
  if (!isLoggedIn) return;

  try {
    const res = await fetch('/admin/bookings');
    const bookings = await res.json();

    const container = document.getElementById('bookings-container');
    container.innerHTML = '';

    if (bookings.length === 0) {
      container.innerHTML = '<p class="no-bookings">No bookings yet</p>';
      return;
    }

    // Group bookings by day
    const bookingsByDay = {};
    days.forEach(day => {
      bookingsByDay[day] = bookings.filter(b => b.day === day).sort((a, b) => a.start_time - b.start_time);
    });

    // Create sections for each day
    days.forEach(day => {
      const dayBookings = bookingsByDay[day];
      
      const daySection = document.createElement('div');
      daySection.className = 'day-section';
      
      let html = `<h3>📅 ${day}</h3>`;
      
      if (dayBookings.length === 0) {
        html += '<p class="no-bookings">No bookings</p>';
      } else {
        dayBookings.forEach(booking => {
          const timeDisplay = `${minutesToTime(booking.start_time)} - ${minutesToTime(booking.end_time)}`;
          html += `
            <div class="booking-card">
              <div class="booking-time">${timeDisplay}</div>
              <div class="booking-name">${booking.name}</div>
              <div class="booking-bags">${booking.bags} bag${booking.bags > 1 ? 's' : ''}</div>
              <button class="delete-btn" onclick="deleteBooking(${booking.id})">🗑️ Delete Booking</button>
            </div>
          `;
        });
      }
      
      daySection.innerHTML = html;
      container.appendChild(daySection);
    });
  } catch (err) {
    console.error("Error loading bookings:", err);
  }
}

// Delete a booking
async function deleteBooking(id) {
  if (!confirm('Are you sure you want to delete this booking?')) {
    return;
  }

  try {
    const res = await fetch(`/admin/booking/${id}`, {
      method: 'DELETE'
    });

    const result = await res.json();

    if (res.ok) {
      alert('✅ Booking deleted successfully');
      loadBookings();
    } else {
      alert('❌ Error: ' + result.error);
    }
  } catch (err) {
    alert('❌ Network error. Please try again.');
  }
}

// Populate time dropdowns
function populateTimeDropdowns() {
  const startSelect = document.getElementById('close-start');
  const endSelect = document.getElementById('close-end');

  startSelect.innerHTML = '<option value="">-- Select Start Time --</option>';
  endSelect.innerHTML = '<option value="">-- Select End Time --</option>';

  // Generate 15-minute intervals
  for (let time = MILL_START; time < MILL_END; time += 15) {
    const option = document.createElement('option');
    option.value = time;
    option.textContent = minutesToTime(time);
    startSelect.appendChild(option);

    const endOption = document.createElement('option');
    endOption.value = time + 15; // Minimum 15 minutes
    endOption.textContent = minutesToTime(time + 15);
    endSelect.appendChild(endOption);
  }

  // Add end of day option
  const endDayOption = document.createElement('option');
  endDayOption.value = MILL_END;
  endDayOption.textContent = minutesToTime(MILL_END);
  endSelect.appendChild(endDayOption);
}

// Close a slot
async function closeSlot() {
  const day = document.getElementById('close-day').value;
  const startTime = parseInt(document.getElementById('close-start').value);
  const endTime = parseInt(document.getElementById('close-end').value);
  const reason = document.getElementById('close-reason').value.trim();
  const errorElement = document.getElementById('close-error');

  errorElement.textContent = '';

  if (!day) {
    errorElement.textContent = 'Please select a day';
    return;
  }

  if (!startTime && startTime !== 0) {
    errorElement.textContent = 'Please select start time';
    return;
  }

  if (!endTime && endTime !== 0) {
    errorElement.textContent = 'Please select end time';
    return;
  }

  if (endTime <= startTime) {
    errorElement.textContent = 'End time must be after start time';
    return;
  }

  try {
    const res = await fetch('/admin/close-slot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ day, startTime, endTime, reason })
    });

    const result = await res.json();

    if (res.ok) {
      alert('✅ Slot closed successfully');
      document.getElementById('close-day').value = '';
      document.getElementById('close-start').value = '';
      document.getElementById('close-end').value = '';
      document.getElementById('close-reason').value = '';
      loadClosedSlots();
    } else {
      if (result.bookings && result.bookings.length > 0) {
        let bookingList = result.bookings.map(b => 
          `${b.name} - ${minutesToTime(b.start_time)} to ${minutesToTime(b.end_time)}`
        ).join('\n');
        errorElement.textContent = result.error + '\n\nExisting bookings:\n' + bookingList;
      } else {
        errorElement.textContent = result.error || 'Error closing slot';
      }
    }
  } catch (err) {
    errorElement.textContent = 'Network error. Please try again.';
  }
}

// Load closed slots
async function loadClosedSlots() {
  if (!isLoggedIn) return;

  try {
    const res = await fetch('/admin/closed-slots');
    const closedSlots = await res.json();

    const container = document.getElementById('closed-slots-container');
    container.innerHTML = '';

    if (closedSlots.length === 0) {
      container.innerHTML = '<p class="no-closed">No closed slots</p>';
      return;
    }

    // Group by day
    const slotsByDay = {};
    days.forEach(day => {
      slotsByDay[day] = closedSlots.filter(s => s.day === day).sort((a, b) => a.start_time - b.start_time);
    });

    // Display closed slots
    let hasSlots = false;
    days.forEach(day => {
      const daySlots = slotsByDay[day];
      
      if (daySlots.length > 0) {
        hasSlots = true;
        daySlots.forEach(slot => {
          const timeDisplay = `${minutesToTime(slot.start_time)} - ${minutesToTime(slot.end_time)}`;
          const card = document.createElement('div');
          card.className = 'closed-card';
          card.innerHTML = `
            <h4>🚫 ${day}</h4>
            <div class="closed-time">${timeDisplay}</div>
            <div class="closed-reason">${slot.reason || 'No reason provided'}</div>
            <button class="open-btn" onclick="openSlot(${slot.id})">✅ Open This Slot</button>
          `;
          container.appendChild(card);
        });
      }
    });

    if (!hasSlots) {
      container.innerHTML = '<p class="no-closed">No closed slots</p>';
    }
  } catch (err) {
    console.error("Error loading closed slots:", err);
  }
}

// Open a closed slot
async function openSlot(id) {
  if (!confirm('Are you sure you want to open this slot?')) {
    return;
  }

  try {
    const res = await fetch(`/admin/close-slot/${id}`, {
      method: 'DELETE'
    });

    const result = await res.json();

    if (res.ok) {
      alert('✅ Slot opened successfully');
      loadClosedSlots();
    } else {
      alert('❌ Error: ' + result.error);
    }
  } catch (err) {
    alert('❌ Network error. Please try again.');
  }
}

// Listen for real-time updates
socket.on('update', () => {
  loadBookings();
});

socket.on('admin-update', () => {
  loadBookings();
  loadClosedSlots();
});