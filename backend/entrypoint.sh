#!/bin/sh
python manage.py migrate --noinput
python -m gunicorn config.wsgi:application --bind 0.0.0.0:8000 --workers 2 --timeout 600 --access-logfile - 2>/dev/null \
  || python manage.py runserver 0.0.0.0:8000
