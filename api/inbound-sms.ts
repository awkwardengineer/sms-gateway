import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getPlivoForm } from "../lib/plivoBody";
import { isAuthorizedSender } from "../lib/phone";
import { plivoEmptyResponseXml, plivoMessageXml } from "../lib/plivoXml";
import { fetchCurrentWeatherForZip, formatWeatherSms } from "../lib/weather";

const WEATHER_REGEX = /\bweather\b/i;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "GET") {
    res.status(200).send("sms-gateway ok");
    return;
  }

  if (req.method !== "POST") {
    res.status(405).send("Method Not Allowed");
    return;
  }

  const form = getPlivoForm(req);
  const from = form.From;
  const text = form.Text ?? "";

  const myPhone = process.env.MY_PHONE_E164;
  if (!isAuthorizedSender(from, myPhone)) {
    res.setHeader("Content-Type", "application/xml");
    res.status(200).send(plivoEmptyResponseXml());
    return;
  }

  const weatherZip = process.env.WEATHER_ZIP;

  if (WEATHER_REGEX.test(text)) {
    try {
      if (!weatherZip?.trim()) {
        throw new Error("WEATHER_ZIP is not set");
      }
      const weather = await fetchCurrentWeatherForZip(weatherZip);
      console.log(
        JSON.stringify({
          intent: "weather",
          from: "authorized",
          openMeteo: {
            zip: weather.zip,
            placeLabel: weather.placeLabel,
            time: weather.time,
            tempF: weather.tempF,
            weatherCode: weather.weatherCode,
            summary: weather.summary,
            lat: weather.lat,
            lon: weather.lon,
          },
        })
      );
      res.setHeader("Content-Type", "application/xml");
      res.status(200).send(plivoMessageXml(formatWeatherSms(weather)));
    } catch (err) {
      console.error("weather fetch failed", err);
      res.setHeader("Content-Type", "application/xml");
      res
        .status(200)
        .send(plivoMessageXml("Weather unavailable right now. Try again later."));
    }
    return;
  }

  res.setHeader("Content-Type", "application/xml");
  res.status(200).send(plivoMessageXml("hello world"));
}
