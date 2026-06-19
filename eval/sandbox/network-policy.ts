export interface NetworkPolicyConfig {
  allowOut: string[];
  denyOut?: string[];
  allowPublicTraffic: boolean;
}

export function generateE2BNetworkConfig(allowedHosts: string[]): NetworkPolicyConfig {
  const resolvedHosts = allowedHosts.map((host) => {
    const h = host.replace(/^https?:\/\//, '').split('/')[0].split(':')[0];
    return h;
  });

  return {
    allowOut: resolvedHosts,
    allowPublicTraffic: false,
  };
}

export function createNetworkRestrictionScript(allowedHosts: string[]): string {
  const dnsServers = ['1.1.1.1', '8.8.8.8', '8.8.4.4'];
  const lines: string[] = [
    '#!/bin/sh',
    'set -e',
    '',
    'iptables -P INPUT DROP',
    'iptables -P FORWARD DROP',
    'iptables -P OUTPUT DROP',
    '',
    'iptables -A INPUT -i lo -j ACCEPT',
    'iptables -A OUTPUT -o lo -j ACCEPT',
    '',
    'iptables -A INPUT -m state --state ESTABLISHED,RELATED -j ACCEPT',
    'iptables -A OUTPUT -m state --state ESTABLISHED,RELATED -j ACCEPT',
    '',
  ];

  for (const dns of dnsServers) {
    lines.push(`iptables -A OUTPUT -d ${dns} -p udp --dport 53 -j ACCEPT`);
  }
  lines.push('');

  for (const host of allowedHosts) {
    const h = host.replace(/^https?:\/\//, '').split('/')[0].split(':')[0];
    lines.push(`iptables -A OUTPUT -d ${h} -p tcp --dport 443 -j ACCEPT`);
    lines.push(`iptables -A OUTPUT -d ${h} -p tcp --dport 80 -j ACCEPT`);
  }
  lines.push('');

  lines.push('iptables -A OUTPUT -j REJECT');
  lines.push('iptables -A INPUT -j REJECT');

  return lines.join('\n');
}

export const DEFAULT_ALLOWED_GIT_HOSTS = [
  'github.com',
  'gitlab.com',
  'raw.githubusercontent.com',
  'api.github.com',
];
