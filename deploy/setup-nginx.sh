#!/usr/bin/env bash
# Run as root after Compose is healthy. Adapted from meal-manager's setup-nginx.sh;
# installs only this app's named site and certificate and leaves meal-manager's alone.
set -euo pipefail

project_dir=${1:?Pass the project directory}
nginx_dir=/etc/nginx
certbot_dir=/etc/letsencrypt
webroot=/var/www/letsencrypt
domain=rentalreview.boringman.in
site="$nginx_dir/conf.d/rental-review.conf"

if ! command -v nginx >/dev/null || ! nginx -v >/dev/null 2>&1; then
    apt-get update
    DEBIAN_FRONTEND=noninteractive apt-get install -y nginx
fi
if ! command -v certbot >/dev/null || ! certbot --version >/dev/null 2>&1; then
    apt-get update
    DEBIAN_FRONTEND=noninteractive apt-get install -y certbot
fi
install -m 755 -d "$nginx_dir/conf.d" "$webroot"

config=nginx-http.conf
if [[ -s "$certbot_dir/live/$domain/fullchain.pem" && -s "$certbot_dir/live/$domain/privkey.pem" ]]; then
    config=nginx.conf
fi
install -m 644 "$project_dir/deploy/$config" "$site"

nginx -t
systemctl enable --now nginx
systemctl reload nginx

# Webroot validation leaves Nginx configuration under deployment control.
# meal-manager installs the same reload hook; writing it again is harmless.
install -m 755 -d "$certbot_dir/renewal-hooks/deploy"
printf '%s\n' '#!/usr/bin/env bash' 'set -euo pipefail' \
    'nginx -t' 'systemctl reload nginx' \
    > "$certbot_dir/renewal-hooks/deploy/reload-nginx"
chmod 755 "$certbot_dir/renewal-hooks/deploy/reload-nginx"
certbot certonly --webroot --webroot-path "$webroot" \
    --cert-name "$domain" --domain "$domain" \
    --non-interactive --agree-tos --register-unsafely-without-email --keep-until-expiring

install -m 644 "$project_dir/deploy/nginx.conf" "$site"
nginx -t
systemctl reload nginx
systemctl enable --now certbot.timer

for path in health api/health/ready; do
    curl --fail --silent --show-error --retry 5 --retry-connrefused --retry-delay 1 \
        --resolve "$domain:443:127.0.0.1" "https://$domain/$path" -o /dev/null
done
echo "Nginx proxy healthy: https://$domain -> 127.0.0.1:4180"
