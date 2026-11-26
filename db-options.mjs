const brainSearchPath = 'crm,brain,public';

// Keep legacy installations on their existing server defaults unless the Brain
// connection explicitly opts in. Never interpolate arbitrary schemas/options.
export function postgresSessionOptions(config, environment = process.env) {
  const configuredPath = config?.searchPath;
  const searchPath = configuredPath === undefined || configuredPath === null || configuredPath === ''
    ? environment.BRAIN_APITO_SEARCH_PATH : configuredPath;
  if (searchPath !== undefined && searchPath !== '') {
    if (searchPath !== brainSearchPath) {
      throw new Error('BRAIN_APITO_SEARCH_PATH/searchPath deve ser crm,brain,public');
    }
    return {application_name: 'crm-apito', options: '-c search_path=' + brainSearchPath};
  }
  return {application_name: 'crm-apito'};
}

export function postgresConnectionOptions(connection, sessionOptions) {
  const options = {...connection, ...sessionOptions};
  // node-postgres gives URL query parameters precedence over Pool options.
  // When Brain is enabled, pin its validated namespace in the URL too.
  if (connection.connectionString && sessionOptions.options) {
    let uri;
    try { uri = new URL(connection.connectionString); }
    catch { throw new Error('DATABASE_URL PostgreSQL inválida'); }
    if (!['postgres:', 'postgresql:'].includes(uri.protocol)) throw new Error('DATABASE_URL PostgreSQL inválida');
    uri.searchParams.set('application_name', sessionOptions.application_name);
    uri.searchParams.set('options', sessionOptions.options);
    options.connectionString = uri.toString();
  }
  return options;
}
