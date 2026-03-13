const axios = require("axios");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createChargedeskClient(apiKey) {
  if (!apiKey) {
    throw new Error("CHARGEDESK_API_KEY is required");
  }

  const client = axios.create({
    baseURL: "https://api.chargedesk.com/v1",
    auth: { username: apiKey, password: "" },
  });

  // Respect rate limit headers with retry
  client.interceptors.response.use(null, async (error) => {
    const status = error.response?.status;
    const retryCount = error.config._retryCount || 0;

    if (status === 429 && retryCount < 5) {
      const retryAfter = parseInt(error.response.headers["retry-after"], 10) || 10;
      console.log(`  [RATE-LIMITED] Retrying in ${retryAfter}s...`);
      await sleep(retryAfter * 1000);
      error.config._retryCount = retryCount + 1;
      return client.request(error.config);
    }

    return Promise.reject(error);
  });

  // Fetch all charges with deep pagination using occurred[max]
  async function listAllCharges(params = {}) {
    const allCharges = [];
    const count = params.count || 500;
    let occurredMax = params.occurredMax || undefined;

    while (true) {
      const queryParams = { count };
      if (occurredMax) {
        queryParams["occurred[max]"] = occurredMax;
      }

      const { data } = await client.get("/charges", { params: queryParams });
      const charges = data.data || [];

      if (charges.length === 0) {
        break;
      }

      allCharges.push(...charges);

      // If we got fewer than requested, we've reached the end
      if (charges.length < count) {
        break;
      }

      // Use the oldest charge's occurred timestamp for next page
      const oldest = charges[charges.length - 1];
      const nextMax = oldest.occurred;
      if (nextMax === occurredMax) {
        break; // Safety: prevent infinite loop
      }
      occurredMax = nextMax;

      // If caller set a total limit, stop when reached
      if (params.limit && allCharges.length >= params.limit) {
        return allCharges.slice(0, params.limit);
      }
    }

    return allCharges;
  }

  async function getCharge(chargeId) {
    const { data } = await client.get(`/charges/${chargeId}`);
    return data;
  }

  async function listProducts(params = {}) {
    const { data } = await client.get("/products", { params });
    return data.data || [];
  }

  return {
    client,
    listAllCharges,
    getCharge,
    listProducts,
  };
}

module.exports = { createChargedeskClient };
