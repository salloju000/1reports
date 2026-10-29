import { useEffect, useMemo, useState } from "react";
import { normalizeQuery } from "../services/catalog";
export function navigate(
  page: string,
  params: Record<string, string> = {},
  replace = false,
) {
  const query = new URLSearchParams(params);
  const hash = `#/${page}${query.size ? "?" + query : ""}`;
  if (window.location.hash === hash) return;
  if (replace) {
    window.history.replaceState(null, "", hash);
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  } else window.location.hash = hash;
}
export function readRoute() {
  const [page, search = ""] = window.location.hash
    .replace(/^#\/?/, "")
    .split("?");
  const params = new URLSearchParams(search);
  return { page: page || "overview", params, query: normalizeQuery(params) };
}
export function useRoute() {
  const [route, setRoute] = useState(readRoute);
  useEffect(() => {
    const update = () => setRoute(readRoute());
    window.addEventListener("hashchange", update);
    return () => window.removeEventListener("hashchange", update);
  }, []);
  return route;
}
export function useAsync<T>(load: () => Promise<T>, deps: unknown[]) {
  const [retry, setRetry] = useState(0);
  const token = useMemo(() => ({}), [...deps, retry]);
  const [snapshot, setSnapshot] = useState<{
    token: object;
    data?: T;
    error: string;
  }>({ token: {}, error: "" });
  useEffect(() => {
    let active = true;
    Promise.resolve()
      .then(load)
      .then((data) => {
        if (active) setSnapshot({ token, data, error: "" });
      })
      .catch(() => {
        if (active)
          setSnapshot({
            token,
            error: "Unable to load this view. Please try again.",
          });
      });
    return () => {
      active = false;
    };
  }, [token]);
  return {
    data: snapshot.token === token ? snapshot.data : undefined,
    error: snapshot.token === token ? snapshot.error : "",
    loading: snapshot.token !== token,
    retry: () => setRetry((x) => x + 1),
  };
}
