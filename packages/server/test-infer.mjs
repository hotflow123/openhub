const body = { rawName: "doubao-seedance-2-5" };

const resp = await fetch("http://localhost:3000/admin/catalog/infer", {
  method: "POST",
  headers: {
    Authorization: "Basic YWRtaW46YWRtaW4xMjM=",
    "Content-Type": "application/json",
  },
  body: JSON.stringify(body),
});

const json = await resp.json();
console.log(JSON.stringify(json, null, 2));
