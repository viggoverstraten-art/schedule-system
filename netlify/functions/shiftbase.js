exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: corsHeaders(), body: "" };
  }

  // Path after /api/shiftbase → forward to Shiftbase
  // e.g. /.netlify/functions/shiftbase/employees?limit=250
  const sbPath = event.path.replace(/^.*\/shiftbase/, "") || "/";
  const query  = event.rawQuery ? "?" + event.rawQuery : "";
  const url    = `https://app.shiftbase.com/v2${sbPath}${query}`;

  const sbKey = event.headers["x-sb-key"] || "";

  try {
    const res = await fetch(url, {
      method: event.httpMethod,
      headers: {
        "Content-Type": "application/json",
        "Authorization": `API ${sbKey}`,
      },
      body: ["POST", "PUT", "PATCH"].includes(event.httpMethod) ? event.body : undefined,
    });

    const text = await res.text();
    return {
      statusCode: res.status,
      headers: { "Content-Type": "application/json", ...corsHeaders() },
      body: text,
    };
  } catch (err) {
    return { statusCode: 500, headers: corsHeaders(), body: JSON.stringify({ error: err.message }) };
  }
};

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, X-Sb-Key",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  };
}
