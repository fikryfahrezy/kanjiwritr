export function clientAddress(
  request: Request,
  directAddress: string | undefined,
  trustCloudflareProxy: boolean,
): string {
  if (trustCloudflareProxy) {
    const cloudflareAddress = request.headers.get("cf-connecting-ip")?.trim();
    if (cloudflareAddress && isIpAddress(cloudflareAddress))
      return cloudflareAddress;
  }
  return directAddress ?? "unknown";
}

function isIpAddress(value: string): boolean {
  if (value.includes(":")) {
    try {
      new URL(`http://[${value}]/`);
      return true;
    } catch {
      return false;
    }
  }

  const octets = value.split(".");
  return (
    octets.length === 4 &&
    octets.every((octet) => /^\d{1,3}$/.test(octet) && Number(octet) <= 255)
  );
}
