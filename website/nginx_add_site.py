p = '/etc/nginx/conf.d/xinwang.conf'
s = open(p).read()
block = '''
    # CodeLab 官方网站
    location /codelab/ {
        alias /var/www/codelab-site/;
        index index.html;
        charset utf-8;
        try_files $uri $uri/ /codelab/index.html;
    }
'''
# insert after /admin/ block in 443 server (find second 'CodeLab Admin Panel')
marker = '# CodeLab Admin Panel'
idx = s.find(marker, s.find('listen 443'))
if idx == -1:
    idx = s.find('location /api/', s.find('listen 443'))
    end = s.find('}', idx)
    s = s[:end+1] + block + s[end+1:]
else:
    end = s.find('}', idx)
    s = s[:end+1] + block + s[end+1:]
open(p, 'w').write(s)
print('inserted')
