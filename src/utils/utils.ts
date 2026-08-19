export function generatingPermissions(name: string) {
  const generated = name
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ".")
    .replace(/[^a-z0-9.]/g, "");

 const names = name
  .trim()
  .toLowerCase()
  .replace(/\b\w/g, (char) => char.toUpperCase());

  return [
    {
      code: `${generated}.read`,
      name: `View ${names}`
    },
    {
      code: `${generated}.create`,
      name: `Create ${names}`,
    },
    {
      code: `${generated}.delete`,
      name: `Delete ${names}`,
    },
    {
      code: `${generated}.edit`,
      name: `Edit ${names}`,
    },
    {
      code: `${generated}.manage`,
      name: `Manage ${names}`,
    },
  ];
}

// two days dates

export function within2DaysPeriod(start?: Date, end?: Date) {
  const today = new Date();

  const startDate = start
    ? new Date(start)
    : new Date(today);

  if (!start) {
    startDate.setDate(today.getDate() - 2);
  }

  const endDate = end
    ? new Date(end)
    : new Date(today);

  return {
    startDate,
    endDate,
  };
}