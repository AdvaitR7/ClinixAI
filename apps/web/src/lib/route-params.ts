"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";

/** Reads an ID from a dynamic web URL or the query string in the bundled Android app. */
export function useRouteParam(name: string): string {
  const routeParams = useParams<Record<string, string | string[] | undefined>>();
  const routeValue = routeParams[name];
  const [queryValue, setQueryValue] = useState("");

  useEffect(() => {
    setQueryValue(new URLSearchParams(window.location.search).get(name) ?? "");
  }, [name]);

  return (Array.isArray(routeValue) ? routeValue[0] : routeValue) ?? queryValue;
}

/** Builds the fixed route used by the bundled app while keeping record IDs out of the pathname. */
export function recordHref(
  route: string,
  name: string,
  value: string,
  extra: Record<string, string> = {},
  suffix = "",
): string {
  const query = new URLSearchParams({ ...extra, [name]: value });
  return `${route}/by-id${suffix}?${query.toString()}`;
}
