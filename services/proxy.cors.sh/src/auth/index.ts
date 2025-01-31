import * as express from "express";
import { validate_tmp_key } from "./keys-temp";
import { verify_synced_key } from "./keys-synced";
import { keyinfo } from "./keys";
import { headerfrom } from "../_util/x-header";
import { STATIC_CORS_ACCOUNT_API_KEY_HEADERS } from "../k";
import * as legacy from "./legacy";

export async function authorization(
  req: express.Request,
  res: express.Response,
  next
) {
  // 0. demo - no auth, allow all requests from https://cors.sh/playground  (https://playground.cors.sh), rate limited by fixed rate
  //    - uses ip as id
  // 1. legacy - static api key, rate limited by fixed rate
  //    - uses api key as id
  // 2. anonymous localhost - only allow requests from localhost, rate limited by fixed rate
  //   - uses ip as id
  // 3. temporary key - allow requests from anywhere (unless expired), rate limited by fixed rate
  //   - uses api key
  // 4. signed key - allow requests from anywhere (unless configured), rate limited by purchased plan
  //   // TODO:
  //   - uses api key as subscription id
  //   - live key - allow requests from anywhere (unless configured), rate limited by purchased plan
  //   - test key - allow requests from anywhere (unless configured), rate limited by fixed rate

  // skip api key check for preflight requests
  if (req.method == "OPTIONS" || req.method == "HEAD") {
    next();
  }

  const apikey = headerfrom(req.headers, STATIC_CORS_ACCOUNT_API_KEY_HEADERS);

  if (!apikey) {
    // no key, anonymous
    const id = anynymous_request_identity(req);
    const authorization: AuthorizationInfo = {
      authorized: false,
      id,
      tier: "anonymous",
    };
    res.locals.authorization = authorization;
    next();
    return;
  }

  const { signature, mode } = keyinfo(apikey!);
  const origin = req.headers.origin;
  const { ip, hostname } = req;

  if (
    origin === "https://cors.sh" ||
    origin === "https://playground.cors.sh" ||
    origin === "https://cors.sh/playground"
  ) {
    const authorization: AuthorizationInfo = {
      authorized: true,
      id: ip,
      tier: "unlimited",
      skip_rate_limit: true,
    };
    res.locals.authorization = authorization;
    next();
    return;
  }

  switch (mode) {
    case "live":
    case "test": {
      // TODO: explicit handling for test / live key
      const verified = await verify_synced_key(signature);
      if (verified) {
        const { plan, billing_group } = verified;
        const authorization: AuthorizationInfo = {
          authorized: true,
          id: billing_group,
          tier: plan,
        };
        res.locals.authorization = authorization;
        next();
        return;
      } else {
        res
          .status(402)
          .send(
            "Your account is suspended. Please make a payment at https://cors.sh"
          );
        return;
      }
      break;
    }
    case "temp": {
      const verified = validate_tmp_key(signature);
      if (verified) {
        const authorization: AuthorizationInfo = {
          authorized: true,
          id: signature,
          tier: "free",
        };
        res.locals.authorization = authorization;
        next();
        return;
      } else {
        res
          .status(401)
          .send("Temporay key expired Get a new one from https://cors.sh");
        return;
      }
      break;
    }
    case "v2022": {
      const verified = legacy.validate_api_key(apikey!);
      if (verified) {
        const authorization: AuthorizationInfo = {
          authorized: true,
          id: signature,
          tier: "2022.t1",
        };
        res.locals.authorization = authorization;
        next();
        return;
      } else {
        res
          .status(401)
          .send("Unauthorized. Get a api key from https://cors.sh");
        return;
      }
      break;
    }
  }
}

export interface AuthorizationInfo {
  authorized: boolean;
  id: string | "demo";
  tier: "anonymous" | "free" | "unlimited" | "2022.t1" | "2023.t1";
  skip_rate_limit?: boolean;
}

function anynymous_request_identity(req: express.Request) {
  if (req.hostname == "localhost") {
    return req.ip;
  } else {
    return req.hostname;
  }
}
