const WEEKDAYS_EN_SHORT = ["S", "M", "T", "W", "T", "F", "S"];

export function renderMonthCalendar(container, year, month, currentDay) {
  const firstWeekday = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const currentWeekday = (firstWeekday + currentDay - 1) % 7;
  const cells = [];

  for (let weekday = 0; weekday < 7; weekday += 1) {
    const classes = ["weekday", weekday === 0 ? "sunday" : "", weekday === currentWeekday ? "current-weekday" : ""]
      .filter(Boolean)
      .join(" ");
    cells.push(`<span class="${classes}">${WEEKDAYS_EN_SHORT[weekday]}</span>`);
  }

  for (let blank = 0; blank < firstWeekday; blank += 1) {
    cells.push('<span aria-hidden="true"></span>');
  }

  for (let day = 1; day <= daysInMonth; day += 1) {
    const column = (firstWeekday + day - 1) % 7;
    const classes = [column === 0 ? "sunday" : "", day === currentDay ? "current" : ""]
      .filter(Boolean)
      .join(" ");
    const current = day === currentDay ? ' aria-current="date"' : "";
    cells.push(`<span class="${classes}"${current}>${day}</span>`);
  }

  container.innerHTML = `
    <p class="mini-title">${year}年 ${month}月</p>
    <div class="mini-grid">${cells.join("")}</div>
  `;
}
