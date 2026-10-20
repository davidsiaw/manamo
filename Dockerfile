FROM ruby:3.4-slim

# build-essential: puma's native extension. nodejs: the unit tests
# (node --test).
RUN apt-get update \
 && apt-get install -y --no-install-recommends build-essential nodejs \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY Gemfile Gemfile.lock ./
RUN bundle install

COPY . .

# weaver's preview server reads PORT (its default is 4567).
ENV PORT=4567
EXPOSE 4567

# Preview mode renders source/*.weave on every request, so with the source
# mounted (`heighliner up -a`) a browser refresh shows an edit.
CMD ["bundle", "exec", "weaver"]
