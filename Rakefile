require 'rspec/core/rake_task'

desc 'Check the syntax of every manifest and template'
task :validate do
  sh 'find puppet -name "*.pp" -exec bundle exec puppet parser validate {} +'
  sh 'find puppet -name "*.epp" -exec bundle exec puppet epp validate {} +'
end

desc 'Style check (configuration in .puppet-lint.rc)'
task :lint do
  sh 'bundle exec puppet-lint puppet'
end

RSpec::Core::RakeTask.new(:spec)

task default: %i[validate lint spec]
