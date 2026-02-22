---
name: weather
description: "Get current weather and forecasts via QWeather (和风天气) API or wttr.in. Use when: user asks about weather, temperature, or forecasts for any location. QWeather provides more accurate data for Chinese cities. wttr.in works for global cities without API key."
homepage: https://dev.qweather.com/
metadata:
  {
    "openclaw":
      {
        "emoji": "🌤️",
        "requires": { "bins": ["curl"], "env": ["QWEATHER_API_KEY"] },
        "primaryEnv": "QWEATHER_API_KEY",
      },
  }
---

# Weather Skill

Get current weather conditions and forecasts.

## When to Use

✅ **USE this skill when:**

- "What's the weather?"
- "Will it rain today/tomorrow?"
- "Temperature in [city]"
- "Weather forecast for the week"
- Travel planning weather checks

## When NOT to Use

❌ **DON'T use this skill when:**

- Historical weather data → use weather archives/APIs
- Climate analysis or trends → use specialized data sources
- Hyper-local microclimate data → use local sensors
- Severe weather alerts → check official NWS sources
- Aviation/marine weather → use specialized services (METAR, etc.)

## Location

Always include a city, region, or airport code in weather queries. For Chinese cities, use city name (e.g., "北京", "上海"). For global cities, use city name or airport code.

## Commands

### QWeather API (Recommended for Chinese cities)

**Get current weather:**

```bash
# Replace 北京 with city name or city ID
curl -s "https://devapi.qweather.com/v7/weather/now?location=101010100&key=$QWEATHER_API_KEY"
```

**Get 3-day forecast:**

```bash
curl -s "https://devapi.qweather.com/v7/weather/3d?location=101010100&key=$QWEATHER_API_KEY"
```

**Get 7-day forecast:**

```bash
curl -s "https://devapi.qweather.com/v7/weather/7d?location=101010100&key=$QWEATHER_API_KEY"
```

### Quick Examples

**Beijing current weather:**

```bash
curl -s "https://devapi.qweather.com/v7/weather/now?location=101010100&key=$QWEATHER_API_KEY" | jq '.now'
```

**Beijing 3-day forecast:**

```bash
curl -s "https://devapi.qweather.com/v7/weather/3d?location=101010100&key=$QWEATHER_API_KEY" | jq '.daily[] | {date, tempMax, tempMin, textDay}'
```

**Shanghai (city ID: 101020100):**

```bash
curl -s "https://devapi.qweather.com/v7/weather/now?location=101020100&key=$QWEATHER_API_KEY"
```

### Common City IDs

- 北京: 101010100
- 上海: 101020100
- 广州: 101280101
- 深圳: 101280601
- 杭州: 101210101
- 南京: 101190101
- 成都: 101270101
- 武汉: 101200101
- 西安: 101110101
- 重庆: 101040100

### wttr.in (Fallback for global cities)

```bash
# One-line summary
curl "wttr.in/London?format=3"

# Detailed current conditions
curl "wttr.in/London?0"

# JSON output
curl -s "wttr.in/London?format=j1"
```

### Format Codes (wttr.in)

- `%c` — Weather condition emoji
- `%t` — Temperature
- `%f` — "Feels like"
- `%w` — Wind
- `%h` — Humidity
- `%p` — Precipitation
- `%l` — Location

## Notes

- QWeather API requires API key configured in `skills.entries.weather.env.QWEATHER_API_KEY`
- wttr.in works without API key but has rate limits
- QWeather provides more accurate data for Chinese cities
