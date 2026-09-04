const WEEKDAYS = [
  { ja: "月", en: "M" },
  { ja: "火", en: "T" },
  { ja: "水", en: "W" },
  { ja: "木", en: "T" },
  { ja: "金", en: "F" },
  { ja: "土", en: "S" },
  { ja: "日", en: "S" },
];

export function renderMonthCalendar(container, year, month, currentDay) {
  const firstWeekday = (new Date(Date.UTC(year, month - 1, 1)).getUTCDay() + 6) % 7;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const currentWeekday = (firstWeekday + currentDay - 1) % 7;
  const cells = [];

  for (let weekday = 0; weekday < 7; weekday += 1) {
    const classes = ["weekday", weekday === currentWeekday ? "current-weekday" : ""]
      .filter(Boolean)
      .join(" ");
    const { ja, en } = WEEKDAYS[weekday];
    cells.push(`<span class="${classes}"><b>${ja}</b><em>/</em><i>${en}</i></span>`);
  }

  for (let blank = 0; blank < firstWeekday; blank += 1) {
    cells.push('<span aria-hidden="true"></span>');
  }

  for (let day = 1; day <= daysInMonth; day += 1) {
    const classes = [
      day === currentDay ? "current" : "",
      day < currentDay ? "past" : "",
    ].filter(Boolean).join(" ");
    const current = day === currentDay ? ' aria-current="date"' : "";
    cells.push(`<span class="${classes}"${current}>${day}</span>`);
  }

  container.innerHTML = `
    <p class="mini-title">${year}年 ${month}月</p>
    <div class="mini-grid">${cells.join("")}</div>
  `;
}
