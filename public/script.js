
const table = document.getElementById("timetable");
const modal = document.getElementById("modal");
const nameInput = document.getElementById("name");
const bagsInput = document.getElementById("bags");
const startTimeSelect = document.getElementById("start-time");
const modalTitle = document.getElementById("modal-title");
const error = document.getElementById("error");
const socket = io();

const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

let currentDay = "";
let availableSlots = [];

function renderTable(data) {
  const bookings = data.bookings || [];
  const closedSlots = data.closedSlots || [];
  
  // Create simple single-row table
  let html = "<tr><th>Bookings</th>";
  days.forEach(day => html += `<th>${day}</th>`);
  html += "</tr>";

  html += "<tr><td class='time-cell'>Weekly Schedule</td>";
  
  days.forEach(day => {
    // Get all bookings for this day, sorted by start time
    const dayBookings = bookings.filter(b => b.day === day).sort((a, b) => a.start_time - b.start_time);
    
    // Get all closed slots for this day
    const dayClosedSlots = closedSlots.filter(c => c.day === day).sort((a, b) => a.start_time - b.start_time);
    
    // Combine bookings and closed slots
    const allItems = [
      ...dayBookings.map(b => ({ ...b, type: 'booking' })),
      ...dayClosedSlots.map(c => ({ ...c, type: 'closed' }))
    ].sort((a, b) => a.start_time - b.start_time);
    
    if (allItems.length === 0) {
      // No bookings or closed slots for this day
      html += `<td><button class="book-btn" onclick="openModal('${day}')">Book Slot</button></td>`;
    } else {
      // Show all items for this day in one cell
      html += `<td class="booked-slot" style="padding: 10px;">`;
      
      allItems.forEach((item, index) => {
        const startHours = Math.floor(item.start_time / 60);
        const startMins = item.start_time % 60;
        const endHours = Math.floor(item.end_time / 60);
        const endMins = item.end_time % 60;
        
        const startPeriod = startHours >= 12 ? "PM" : "AM";
        const endPeriod = endHours >= 12 ? "PM" : "AM";
        const displayStartHours = startHours > 12 ? startHours - 12 : startHours === 0 ? 12 : startHours;
        const displayEndHours = endHours > 12 ? endHours - 12 : endHours === 0 ? 12 : endHours;
        
        const timeLabel = `${displayStartHours}:${startMins.toString().padStart(2, '0')} ${startPeriod} - ${displayEndHours}:${endMins.toString().padStart(2, '0')} ${endPeriod}`;
        
        if (item.type === 'booking') {
          // Show booking
          html += `
            <div class="booking-item" style="margin-bottom: ${index < allItems.length - 1 ? '10px' : '5px'}; padding: 8px; background: white; border-radius: 5px; border-left: 4px solid #0984e3;">
              <div style="font-size: 11px; color: #636e72; font-weight: 600;">${timeLabel}</div>
              <div class="customer-name" style="margin: 3px 0;"><b>${item.name}</b></div>
              <div class="bags-info">${item.bags} bag${item.bags > 1 ? 's' : ''}</div>
            </div>
          `;
        } else {
          // Show closed slot
          html += `
            <div class="closed-item" style="margin-bottom: ${index < allItems.length - 1 ? '10px' : '5px'}; padding: 8px; background: #ffe5e5; border-radius: 5px; border-left: 4px solid #d63031;">
              <div style="font-size: 11px; color: #636e72; font-weight: 600;">${timeLabel}</div>
              <div style="margin: 5px 0; color: #d63031; font-weight: bold; font-size: 14px;">🚫 CLOSED</div>
              <div style="font-size: 12px; color: #2d3436; font-style: italic; background: white; padding: 4px 6px; border-radius: 3px;">${item.reason || 'Not available'}</div>
            </div>
          `;
        }
      });
      
      // Add book button below existing items
      html += `<button class="book-btn" style="margin-top: 8px; width: 100%;" onclick="openModal('${day}')">+ Book Another</button>`;
      html += `</td>`;
    }
  });
  
  html += "</tr>";

  table.innerHTML = html;
}

// Helper function to convert minutes to time string
function minutesToTime(minutes) {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  const period = hours >= 12 ? "PM" : "AM";
  const displayHours = hours > 12 ? hours - 12 : hours === 0 ? 12 : hours;
  return `${displayHours}:${mins.toString().padStart(2, '0')} ${period}`;
}

async function loadSlots() {
  try {
    const res = await fetch("/slots");
    const data = await res.json();
    renderTable(data);
  } catch (err) {
    console.error("Error loading slots:", err);
  }
}

function openModal(day) {
  currentDay = day;
  modal.style.display = "flex";
  modalTitle.textContent = `Book Slot for ${day}`;
  error.textContent = "";
  nameInput.value = "";
  bagsInput.value = "";
  startTimeSelect.innerHTML = '<option value="">First enter number of bags</option>';
  startTimeSelect.disabled = true;
}

function closeModal() {
  modal.style.display = "none";
  nameInput.value = "";
  bagsInput.value = "";
  startTimeSelect.innerHTML = '';
  error.textContent = "";
}

// Update available slots when bags change
bagsInput.addEventListener('input', async function() {
  const bags = parseInt(bagsInput.value);
  
  console.log("Bags input changed:", bags, "Current day:", currentDay);
  
  if (!bags || bags < 1) {
    startTimeSelect.innerHTML = '<option value="">First enter number of bags</option>';
    startTimeSelect.disabled = true;
    return;
  }
  
  try {
    startTimeSelect.disabled = true;
    startTimeSelect.innerHTML = '<option value="">Loading available slots...</option>';
    
    const url = `/available-slots?day=${currentDay}&bags=${bags}`;
    console.log("Fetching:", url);
    
    const res = await fetch(url);
    console.log("Response status:", res.status);
    
    if (!res.ok) {
      const errorData = await res.json();
      console.error("Server error:", errorData);
      throw new Error(errorData.error || "Server error");
    }
    
    availableSlots = await res.json();
    console.log("Available slots:", availableSlots);
    
    startTimeSelect.innerHTML = '';
    
    if (availableSlots.length === 0) {
      startTimeSelect.innerHTML = '<option value="">No available slots for this duration</option>';
      startTimeSelect.disabled = true;
      error.textContent = "No available time slots for " + bags + " bag(s). Try fewer bags or another day.";
    } else {
      startTimeSelect.innerHTML = '<option value="">Select start time</option>';
      availableSlots.forEach(slot => {
        const option = document.createElement('option');
        option.value = slot.start;
        option.textContent = slot.display;
        startTimeSelect.appendChild(option);
      });
      startTimeSelect.disabled = false;
      error.textContent = "";
    }
  } catch (err) {
    console.error("Error loading available slots:", err);
    startTimeSelect.innerHTML = '<option value="">Error loading slots</option>';
    startTimeSelect.disabled = true;
    error.textContent = "Error loading available time slots. Please try again.";
  }
});

document.getElementById("submit").onclick = async () => {
  const name = nameInput.value.trim();
  const bags = parseInt(bagsInput.value);
  const startTime = parseInt(startTimeSelect.value);

  if (!name) {
    error.textContent = "Please enter your name";
    return;
  }

  if (!bags || bags < 1) {
    error.textContent = "Please enter valid number of bags";
    return;
  }

  if (!startTime && startTime !== 0) {
    error.textContent = "Please select a start time";
    return;
  }

  try {
    const res = await fetch("/book", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ day: currentDay, name, bags, startTime })
    });

    const result = await res.json();

    if (res.ok) {
      closeModal();
      loadSlots();
      alert(`✅ Slot booked successfully!\n\n📅 Day: ${currentDay}\n⏰ Time: ${result.timeDisplay}\n👤 Name: ${name}\n📦 Bags: ${bags}`);
    } else {
      error.textContent = result.error || "Error booking slot";
    }
  } catch (err) {
    error.textContent = "Network error. Please try again.";
  }
};

socket.on("update", loadSlots);

loadSlots();