const WEEKDAYS_JA_SHORT = ["日", "月", "火", "水", "木", "金", "土"];

export function renderMonthCalendar(container, year, month, currentDay) {
  const firstWeekday = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const cells = [];

  for (let weekday = 0; weekday < 7; weekday += 1) {
    const sundayClass = weekday === 0 ? " sunday" : "";
    cells.push(`<span class="weekday${sundayClass}">${WEEKDAYS_JA_SHORT[weekday]}</span>`);
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
