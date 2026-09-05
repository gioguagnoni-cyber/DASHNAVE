// Shared by the isolated scheduler UI and the server worker. No financial data.
export const TIMEZONE = "America/Sao_Paulo";
export const WEEKDAYS = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];
const clockFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone:TIMEZONE, year:"numeric", month:"2-digit", day:"2-digit",
  hour:"2-digit", minute:"2-digit", hourCycle:"h23"
});
export const defaults = () => ({ enabled:false, start_time:"00:01", end_time:"09:00", weekdays:[1,2,3,4,5], timezone:TIMEZONE });

export function validateSchedule(value) {
  const errors = [];
  const time = /^(?:[01]\d|2[0-3]):[0-5]\d(?::00)?$/;
  if (typeof value.enabled !== "boolean") errors.push("Informe se a automação está habilitada.");
  if (!time.test(value.start_time) || !time.test(value.end_time)) errors.push("Informe horários válidos.");
  if (value.start_time?.slice(0,5) >= value.end_time?.slice(0,5)) errors.push("Ligar deve ser antes de pausar, no mesmo dia.");
  if (!Array.isArray(value.weekdays) || !value.weekdays.length || value.weekdays.some(day => !Number.isInteger(day) || day < 1 || day > 7) || new Set(value.weekdays).size !== value.weekdays.length) errors.push("Selecione ao menos um dia da semana, sem repetições.");
  if (value.timezone !== TIMEZONE) errors.push("Os agendamentos usam o horário de Brasília.");
  return errors;
}

export function localClock(instant = new Date()) {
  const parts = Object.fromEntries(clockFormatter.formatToParts(instant).map(part => [part.type,part.value]));
  const date = `${parts.year}-${parts.month}-${parts.day}`;
  return { date, time:`${parts.hour}:${parts.minute}`, weekday:new Date(`${date}T12:00:00Z`).getUTCDay() || 7 };
}

// A completed transition is not repeated in the same window. This preserves a
// manual pause made after the daily activation until the next scheduled window.
export function plannedState(schedule, instant = new Date()) {
  const errors = validateSchedule(schedule);
  if (errors.length) throw new Error(errors.join(" "));
  if (!schedule.enabled) return null;
  const clock = localClock(instant);
  const start = schedule.start_time.slice(0,5), end = schedule.end_time.slice(0,5);
  const selected = schedule.weekdays.includes(clock.weekday);
  const active = selected && clock.time >= start && clock.time < end;
  const boundary = active ? start : selected && clock.time >= end ? end : "00:00";
  return { desired_status:active ? "ACTIVE" : "PAUSED", window_key:`${clock.date}T${boundary}`, date:clock.date, timezone:TIMEZONE };
}

export function nextTransition(schedule, instant = new Date()) {
  if (validateSchedule(schedule).length || !schedule.enabled) return null;
  const date = localClock(instant).date;
  for (let offset=0; offset<8; offset++) {
    const day = new Date(`${date}T12:00:00Z`);
    day.setUTCDate(day.getUTCDate()+offset);
    const iso = day.toISOString().slice(0,10);
    if (!schedule.weekdays.includes(day.getUTCDay() || 7)) continue;
    // Resolve local time through Intl rather than assuming the account's zone.
    for (const [time,status] of [[schedule.start_time,"ACTIVE"],[schedule.end_time,"PAUSED"]]) {
      let candidate = new Date(`${iso}T${time.slice(0,5)}:00Z`);
      for (let i=0;i<3;i++) {
        const clock = localClock(candidate);
        const observed = Date.parse(`${clock.date}T${clock.time}:00Z`);
        const target = Date.parse(`${iso}T${time.slice(0,5)}:00Z`);
        candidate = new Date(candidate.getTime()+target-observed);
      }
      // Days and same-day boundaries are already in chronological order.
      if (candidate > instant) return { at:candidate.toISOString(), status };
    }
  }
  return null;
}
