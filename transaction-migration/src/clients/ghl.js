const axios = require("axios");

function createGhlClient(apiToken) {
  if (!apiToken) {
    throw new Error("GHL_API_TOKEN is required");
  }

  const client = axios.create({
    baseURL: "https://services.leadconnectorhq.com",
    headers: {
      Authorization: `Bearer ${apiToken}`,
      Version: "2021-07-28",
    },
  });

  async function listInvoices(locationId, params = {}) {
    const allInvoices = [];
    let offset = 0;
    const limit = params.limit || 100;

    while (true) {
      const { data } = await client.get("/invoices", {
        params: {
          altId: locationId,
          altType: "location",
          limit,
          offset,
          ...params,
        },
      });

      const invoices = data.invoices || data.data || [];
      allInvoices.push(...invoices);

      // Stop if we got fewer than the limit (last page) or no results
      if (invoices.length < limit || invoices.length === 0) {
        break;
      }

      offset += invoices.length;

      // Safety: if caller passed a limit via params, respect it as a total cap
      if (params.limit && allInvoices.length >= params.limit) {
        break;
      }
    }

    return allInvoices;
  }

  async function getInvoice(invoiceId) {
    const { data } = await client.get(`/invoices/${invoiceId}`);
    return data;
  }

  return { listInvoices, getInvoice };
}

module.exports = { createGhlClient };
