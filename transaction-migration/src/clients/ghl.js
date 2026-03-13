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
    const limit = params.limit || 100;
    let offset = "0";

    while (true) {
      const queryParams = {
        altId: locationId,
        altType: "location",
        limit: String(limit),
        offset,
      };

      const { data } = await client.get("/invoices/", { params: queryParams });

      const invoices = data.invoices || data.data || [];
      allInvoices.push(...invoices);

      // Stop if we got fewer than the limit (last page) or no results
      if (invoices.length < limit || invoices.length === 0) {
        break;
      }

      offset = String(allInvoices.length);

      // If caller passed a limit, respect it as a total cap
      if (params.limit && allInvoices.length >= params.limit) {
        break;
      }
    }

    return allInvoices;
  }

  async function getInvoice(invoiceId) {
    const { data } = await client.get(`/invoices/${invoiceId}`, {
      params: { altId: invoiceId, altType: "location" },
    });
    return data;
  }

  return { listInvoices, getInvoice };
}

module.exports = { createGhlClient };
