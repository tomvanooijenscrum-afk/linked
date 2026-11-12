(function (global) {
  const helpPointData = {
    eventName: "Stratumseind, Eindhoven",
    eventLabel: "Stratumseind help points",
    helpPoints: [
      {
        id: "catharinaplein",
        name: "Catharinaplein Help Point",
        location:
          "Northern entrance of Stratumseind, near Catharinaplein and St. Catharine's Church, Eindhoven.",
        openingHours: [
          { days: [5, 6], opens: "22:00", closes: "04:00" },
        ],
        directions:
          "Walk along Stratumseind toward Catharinaplein. The large church with two towers marks the northern entrance.",
        landmarks: [
          "St. Catharine's Church",
          "The church's two recognizable towers",
          "Catharinaplein",
        ],
        closedDates: [],
        closedPeriods: [],
      },
      {
        id: "stratumseind-central",
        name: "Stratumseind Central Help Point",
        location:
          "Central section of Stratumseind, near the intersection with 't College, Eindhoven.",
        openingHours: [
          { days: [5, 6], opens: "21:00", closes: "03:00" },
        ],
        directions:
          "Follow Stratumseind until you reach the intersection with 't College.",
        landmarks: [
          "Stratumseind nightlife street",
          "Side street 't College",
        ],
        closedDates: [],
        closedPeriods: [],
      },
      {
        id: "dommelbrug",
        name: "Dommelbrug Help Point",
        location:
          "Southern end of Stratumseind, near the bridge over the Dommel toward Stratumsedijk, Eindhoven.",
        openingHours: [
          { days: [5, 6], opens: "23:00", closes: "05:00" },
        ],
        directions:
          "Walk south along Stratumseind toward the Dommel river. The bridge near the transition toward Stratumsedijk marks the southern end of the nightlife street.",
        landmarks: [
          "Dommel river",
          "Southern end of Stratumseind",
          "Stratumsedijk",
        ],
        closedDates: [],
        closedPeriods: [],
      },
    ],
  };

  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
  const datePattern = /^\d{4}-\d{2}-\d{2}$/;
  const dateTimePattern = /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d$/;

  function parseTime(value) {
    if (typeof value !== "string" || !timePattern.test(value)) {
      return null;
    }
    const [hour, minute] = value.split(":").map(Number);
    return hour * 60 + minute;
  }

  function parseLocalDate(value, pattern) {
    if (typeof value !== "string" || !pattern.test(value)) {
      return null;
    }
    const date = new Date(value.length === 10 ? `${value}T00:00` : value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function isValidDate(value) {
    const date = parseLocalDate(value, datePattern);
    return Boolean(date && localDateKey(date) === value);
  }

  function parseLocalDateTime(value) {
    const date = parseLocalDate(value, dateTimePattern);
    if (!date) {
      return null;
    }
    const [datePart, timePart] = value.split("T");
    return isValidDate(datePart) && parseTime(timePart) !== null ? date : null;
  }

  function validateHelpPointData(points) {
    if (!Array.isArray(points)) {
      return ["Help points must be an array."];
    }

    const errors = [];
    const seenIds = new Set();
    points.forEach((point, index) => {
      const prefix = `Help point ${index + 1}`;
      if (!point || typeof point !== "object") {
        errors.push(`${prefix} must be an object.`);
        return;
      }

      for (const field of ["id", "name", "location", "directions"]) {
        if (typeof point[field] !== "string" || !point[field].trim()) {
          errors.push(`${prefix} needs a non-empty ${field}.`);
        }
      }
      if (
        typeof point.id === "string" &&
        (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(point.id) || seenIds.has(point.id))
      ) {
        errors.push(`${prefix} needs a unique, lowercase hyphenated id.`);
      }
      if (typeof point.id === "string") {
        seenIds.add(point.id);
      }
      if (
        !Array.isArray(point.landmarks) ||
        point.landmarks.length === 0 ||
        point.landmarks.some((landmark) => typeof landmark !== "string" || !landmark.trim())
      ) {
        errors.push(`${prefix} needs at least one valid landmark.`);
      }
      if (!Array.isArray(point.openingHours) || point.openingHours.length === 0) {
        errors.push(`${prefix} needs at least one opening-hours rule.`);
      } else {
        point.openingHours.forEach((rule) => {
          if (
            !rule ||
            !Array.isArray(rule.days) ||
            rule.days.length === 0 ||
            rule.days.some((day) => !Number.isInteger(day) || day < 0 || day > 6) ||
            parseTime(rule.opens) === null ||
            parseTime(rule.closes) === null ||
            parseTime(rule.opens) === parseTime(rule.closes)
          ) {
            errors.push(`${prefix} has an invalid opening-hours rule.`);
          }
        });
      }
      if (
        !Array.isArray(point.closedDates) ||
        point.closedDates.some((date) => !isValidDate(date))
      ) {
        errors.push(`${prefix} has an invalid closed date.`);
      }
      if (
        !Array.isArray(point.closedPeriods) ||
        point.closedPeriods.some((period) => {
          if (!period) {
            return true;
          }
          const start = parseLocalDateTime(period.start);
          const end = parseLocalDateTime(period.end);
          return !start || !end || start >= end;
        })
      ) {
        errors.push(`${prefix} has an invalid closed period.`);
      }
    });

    return errors;
  }

  function localDateKey(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function isOpenNow(point, now = new Date()) {
    if (
      !point ||
      typeof now.getTime !== "function" ||
      Number.isNaN(now.getTime()) ||
      !Array.isArray(point.openingHours)
    ) {
      return false;
    }

    const currentDate = localDateKey(now);
    const closedDates = Array.isArray(point.closedDates) ? point.closedDates : [];
    if (closedDates.includes(currentDate)) {
      return false;
    }

    const active = [-1, 0].some((dayOffset) => {
      const openingDate = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate() + dayOffset,
      );
      if (closedDates.includes(localDateKey(openingDate))) {
        return false;
      }

      const openingMinute = openingDate.getHours() * 60 + openingDate.getMinutes();
      return point.openingHours.some((rule) => {
        if (!rule.days.includes(openingDate.getDay())) {
          return false;
        }

        const opens = parseTime(rule.opens);
        const closes = parseTime(rule.closes);
        if (opens === null || closes === null) {
          return false;
        }

        const startsAt = new Date(openingDate);
        startsAt.setHours(Math.floor(opens / 60), opens % 60, 0, 0);
        const endsAt = new Date(openingDate);
        if (closes <= opens) {
          endsAt.setDate(endsAt.getDate() + 1);
        }
        endsAt.setHours(Math.floor(closes / 60), closes % 60, 0, 0);
        return now >= startsAt && now < endsAt;
      });
    });

    if (!active) {
      return false;
    }

    const closedPeriods = Array.isArray(point.closedPeriods)
      ? point.closedPeriods
      : [];
    return !closedPeriods.some((period) => {
      const startsAt = parseLocalDateTime(period.start);
      const endsAt = parseLocalDateTime(period.end);
      return startsAt && endsAt && now >= startsAt && now < endsAt;
    });
  }

  global.LinkedHelpPointData = helpPointData;
  global.LinkedHelpPoints = {
    dayNames,
    isOpenNow,
    validateHelpPointData,
  };
})(globalThis);
